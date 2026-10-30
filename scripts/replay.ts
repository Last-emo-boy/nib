// Replay recorded `execute` calls against copies of their documents and compare outcomes.
// node scripts/replay.ts <calls.json> <workDir>
// calls.json: [{filePath, input?, editId?, edits?, originalOk}] in call order. Each document is copied
// into workDir once and all its calls run in one session, as they did in the original agent session.
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { PenDoc } from '@nib/core';
import { parsePen } from '@nib/format';
import { EXPORTERS } from '@nib/export';
import { ExecSession } from '@nib/exec';
import { createNodeRenderer, imagesFor } from '@nib/render/node';

interface Call { filePath: string; input?: string; editId?: string; edits?: { find: string; replace: string }[]; originalOk: boolean }

const [callsFile, workDir] = process.argv.slice(2);
const calls: Call[] = JSON.parse(await readFile(callsFile, 'utf8'));
await mkdir(workDir, { recursive: true });
const renderer = await createNodeRenderer();
const sessions = new Map<string, ExecSession>();
/** Original editIds map to ours, since a replayed failure gets a new id. */
const editIds = new Map<string, string>();
const results: { i: number; file: string; originalOk: boolean; ok: boolean; error?: string; input: string }[] = [];

for (const [i, call] of calls.entries()) {
  let s = sessions.get(call.filePath);
  if (!s) {
    const copy = join(workDir, `${sessions.size}-${basename(call.filePath)}`);
    await copyFile(call.filePath, copy);
    const doc = new PenDoc(parsePen(await readFile(copy, 'utf8')));
    // Recorded snippets export to absolute paths in real projects: keep every file they write in workDir.
    const exportPath = (p: string) => join(workDir, 'exports', p.replace(/^[/\\]+/, '').replace(/:/g, ''));
    s = await ExecSession.open(doc, { renderer, images: imagesFor(call.filePath), baseDir: dirname(copy), exporters: EXPORTERS, exportPath });
    sessions.set(call.filePath, s);
  }
  if (process.env.NIB_REPLAY_TRACE) process.stderr.write(`@${i}\n`);
  const editId = call.editId ? editIds.get(call.editId) ?? call.editId : undefined;
  const r = await s.execute(call.editId ? { editId, edits: call.edits } : { input: call.input });
  const failed = /`editId`: "(\w+)"/.exec(r.text)?.[1];
  if (failed && call.editId) editIds.set(call.editId, failed);
  const error = r.ok ? undefined : /```\n([^\n]+)/.exec(r.text)?.[1] ?? r.text.split('\n')[0];
  results.push({ i, file: basename(dirname(call.filePath)) + '/' + basename(call.filePath), originalOk: call.originalOk, ok: r.ok, error, input: call.input ?? JSON.stringify(call.edits) });
  if (!r.ok && call.originalOk) process.stderr.write(`#${i} ${error}\n`);
}
await writeFile(join(workDir, 'results.json'), JSON.stringify(results, null, 1));
const both = results.filter((r) => r.originalOk && r.ok).length;
const lost = results.filter((r) => r.originalOk && !r.ok).length;
console.log(`${results.length} calls: ${both} succeeded in both, ${lost} succeeded only in pen.dev, ${results.filter((r) => !r.originalOk && r.ok).length} only in nib, ${results.filter((r) => !r.originalOk && !r.ok).length} failed in both`);
for (const s of sessions.values()) s.dispose();
