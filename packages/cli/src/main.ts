#!/usr/bin/env node
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePen, serializePen, validateNode, type PenDocument } from '@nib/format';
import { DocumentHost, ensureDaemon, framePictures, importFigma, versionFile } from '@nib/daemon';
import { EXPORTERS } from '@nib/export';
import type { ExportFormat } from '@nib/exec';
import { createNodeRenderer, imagesFor } from '@nib/render/node';
import { diffDocs, diffMarkdown, diffText, mergeDocs } from '@nib/core';

const HELP = `nib — design files (.pen) from the command line

  nib render <file.pen> [--frame <name|id>]… [--out <dir>] [--scale 2] [--format png|jpeg|webp]
      Pictures of the top-level frames (or the ones named).
  nib export <file.pen> --format <html-css|html-tailwind|react-tailwind|pdf|site|png|jpeg|webp> [--frame …] [--out <path>]
      Code, a PDF or a website of the design.
  nib validate <file.pen> [--json]
      Schema errors and design problems (clipped, collapsed or missing things); exits 1 on errors.
  nib diff <old.pen> <new.pen>
  nib diff <file.pen> [--from <git ref>] [--to <git ref>]
      What changed, frame by frame (git: from HEAD to the file as it is, unless given).
      --images <dir>  before, after and difference pictures of each changed frame
      --markdown <file>  a summary for a pull request   --json  the diff as JSON
  nib import <file.fig> [--out <folder>]
      A Figma file (File > Save local copy) as a .pen document beside it, or in the folder given.
  nib agent <file.pen> <request…> [--provider <id>] [--model <id>] [--select <id>]
      Ask nib's agent to change the design, and print what it says and does.
  nib open <file.pen>
      Open it in the nib app (or the editor in the browser).
  nib git-setup
      Let git merge .pen files layer by layer in this repository (a merge driver for *.pen).
  nib merge-driver <base> <ours> <theirs> [path]
      The merge git runs (set up by git-setup): writes the merged design over <ours>; exits 1 when
      both sides changed the same thing (ours is kept there, and each case is listed).
`;

interface Args { _: string[]; flags: Record<string, string[]> }

function parseArgs(argv: string[]): Args {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=', 2);
      const value = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true');
      (out.flags[k] ??= []).push(value);
    } else out._.push(a);
  }
  return out;
}

const flag = (a: Args, k: string) => a.flags[k]?.at(-1);
const fail = (message: string): never => { process.stderr.write(`nib: ${message}\n`); process.exit(2); };
/** A path as the person would type it: relative when under the working folder, else absolute. */
const shown = (p: string) => { const r = relative(process.cwd(), p); return r.startsWith('..') ? p : r; };
const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'frame';

function penFile(a: Args, i = 0): string {
  const f = a._[i];
  if (!f || !f.endsWith('.pen')) fail('give a .pen file');
  const path = resolve(f!);
  if (!existsSync(path)) fail(`no such file: ${f}`);
  return path;
}

async function headless() {
  const renderer = await createNodeRenderer();
  return { renderer, host: new DocumentHost({ renderer, images: imagesFor, exporters: EXPORTERS, watch: false, recents: false }) };
}

/** Top-level frames by the names or ids asked for (all of them when none are). */
function framesOf(doc: PenDocument, wanted: string[] | undefined): { id: string; name: string }[] {
  const tops = doc.children.filter((n) => n.enabled !== false).map((n) => ({ id: n.id, name: typeof n.name === 'string' && n.name ? n.name : n.id }));
  if (!wanted?.length) return tops;
  return wanted.map((w) => tops.find((t) => t.id === w) ?? tops.find((t) => t.name.toLowerCase() === w.toLowerCase()) ?? fail(`no top-level frame "${w}"; there are: ${tops.map((t) => t.name).join(', ')}`));
}

async function render(a: Args, exportFormat?: ExportFormat) {
  const path = penFile(a);
  const { host } = await headless();
  try {
    const open = await host.open(path);
    const frames = framesOf(open.session.doc.data, a.flags.frame);
    const format = (exportFormat ?? flag(a, 'format') ?? 'png') as ExportFormat;
    const scale = Number(flag(a, 'scale') ?? 2);
    const raster = ['png', 'jpeg', 'webp'].includes(format);
    const out = resolve(flag(a, 'out') ?? (raster ? dirname(path) : join(dirname(path), `${basename(path, '.pen')}${format === 'pdf' ? '.pdf' : format === 'react-tailwind' ? '.tsx' : format === 'site' ? '-site' : '.html'}`)));
    const files = await host.exportNodes(path, frames.map((f) => f.id), format, scale);
    if (raster) {
      await mkdir(out, { recursive: true });
      for (const [i, f] of files.entries()) {
        // Named after the frame, not its id.
        const frame = frames.find((x) => f.name.startsWith(x.id.replaceAll('/', '_'))) ?? frames[i];
        const file = join(out, `${slug(frame?.name ?? f.name)}.${f.name.split('.').pop()}`);
        await writeFile(file, f.data);
        process.stdout.write(`${shown(file)}\n`);
      }
    } else if (files.length === 1 && format !== 'site') {
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, files[0].data);
      process.stdout.write(`${shown(out)}\n`);
    } else {
      for (const f of files) {
        const file = join(out, f.name);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, f.data);
      }
      process.stdout.write(`${shown(out)}/ (${files.length} files)\n`);
    }
  } finally {
    host.close();
  }
}

async function validate(a: Args) {
  const path = penFile(a);
  let doc: PenDocument;
  try {
    doc = parsePen(await readFile(path, 'utf8'));
  } catch (e) {
    process.stdout.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
  const issues = doc!.children.flatMap((n) => validateNode(n));
  const { host } = await headless();
  try {
    await host.open(path);
    const problems = await host.problems(path);
    const errors = issues.filter((i) => i.level === 'error');
    if (flag(a, 'json')) process.stdout.write(`${JSON.stringify({ issues, problems }, null, 2)}\n`);
    else {
      for (const i of issues) process.stdout.write(`${i.level}: ${i.path}: ${i.message}\n`);
      for (const p of problems) process.stdout.write(`problem: ${p.id}: ${p.message}\n`);
      process.stdout.write(`${errors.length} errors, ${issues.length - errors.length} warnings, ${problems.length} problems\n`);
    }
    process.exitCode = errors.length ? 1 : 0;
  } finally {
    host.close();
  }
}

/** A version of `path` from git (`ref`), as a temporary file beside it so its images still resolve. */
async function fromGit(path: string, ref: string): Promise<string> {
  return (await versionFile(path, ref)) ?? fail(`git has no ${basename(path)} at ${ref}`);
}

async function diff(a: Args) {
  const first = penFile(a);
  const temps: string[] = [];
  let before: string, after: string;
  if (a._[1]) { before = first; after = penFile(a, 1); }
  else {
    before = await fromGit(first, flag(a, 'from') ?? 'HEAD');
    temps.push(before);
    const to = flag(a, 'to');
    after = to ? await fromGit(first, to) : first;
    if (to) temps.push(after);
  }
  try {
    const d = diffDocs(parsePen(await readFile(before, 'utf8')), parsePen(await readFile(after, 'utf8')));
    const images = new Map<string, { before?: string; after?: string; diff?: string; similarity?: number }>();
    const dir = flag(a, 'images');
    if (dir && d.frames.some((f) => f.kind !== 'moved')) {
      const out = resolve(dir);
      await mkdir(out, { recursive: true });
      const { renderer, host } = await headless();
      try {
        await host.open(before);
        await host.open(after);
        const md = flag(a, 'markdown');
        const link = (file: string) => (md ? relative(dirname(resolve(md)), file) : file);
        for (const [id, p] of await framePictures(host, renderer, before, after, d)) {
          const name = slug(d.frames.find((f) => f.id === id)!.name);
          const entry: { before?: string; after?: string; diff?: string; similarity?: number } = { ...(p.similarity !== undefined ? { similarity: p.similarity } : {}) };
          for (const k of ['before', 'after', 'diff'] as const) {
            if (!p[k]) continue;
            const file = join(out, `${name}.${k}.png`);
            await writeFile(file, p[k]!);
            entry[k] = link(file);
          }
          images.set(id, entry);
        }
      } finally {
        host.close();
      }
    }
    if (flag(a, 'json')) process.stdout.write(`${JSON.stringify({ ...d, images: Object.fromEntries(images) }, null, 2)}\n`);
    else process.stdout.write(`${diffText(d)}\n`);
    const md = flag(a, 'markdown');
    if (md) await writeFile(resolve(md), diffMarkdown(d, `Design changes in ${basename(first)}`, images));
  } finally {
    for (const t of temps) await rm(t, { force: true });
  }
}

async function importFig(a: Args) {
  const f = a._[0];
  if (!f || !/\.fig$/i.test(f)) fail('give a .fig file');
  const path = resolve(f!);
  if (!existsSync(path)) fail(`no such file: ${f}`);
  let r: Awaited<ReturnType<typeof importFigma>>;
  try {
    r = await importFigma(new Uint8Array(await readFile(path)), resolve(flag(a, 'out') ?? dirname(path)), basename(path).replace(/\.fig$/i, ''));
  } catch (e) {
    return fail(`${basename(path)} is not a Figma file nib can read (${(e as Error).message})`);
  }
  process.stdout.write(`${shown(r.path)} (${r.layers} layers)\n`);
  for (const n of r.notes) process.stdout.write(`  ${n}\n`);
}

async function agent(a: Args) {
  const path = penFile(a);
  const text = a._.slice(1).join(' ').trim() || fail('say what the agent should do');
  const info = await ensureDaemon();
  const api = async <T>(p: string, body?: unknown): Promise<T> => {
    const r = await fetch(`http://127.0.0.1:${info.port}${p}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${info.token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const j = await r.json() as T & { error?: string };
    if (!r.ok) fail(j.error ?? `the daemon answered ${r.status}`);
    return j;
  };
  const { providers } = await api<{ providers: { id: string; available: boolean }[] }>('/api/agent/providers');
  const provider = flag(a, 'provider') ?? providers.find((p) => p.available)?.id ?? fail('no agent is set up: sign in to Claude or Codex, or add an API key in nib');
  const { session } = await api<{ session: { id: string } }>('/api/agent/send', { doc: path, provider, ...(flag(a, 'model') ? { model: flag(a, 'model') } : {}), text, selection: a.flags.select ?? [] });
  const shown = new Set<string>();
  let failed = false;
  for (;;) {
    const { session: s } = await api<{ session: { running: boolean; items: { id: string; kind: string; text?: string; name?: string; status?: string; changed?: string[] }[] } }>(`/api/agent/session?id=${session.id}`);
    for (const i of s.items) {
      const done = i.kind !== 'tool' || i.status !== 'running';
      if (shown.has(i.id) || !done || (i.kind === 'assistant' && s.running && i === s.items.at(-1))) continue;
      shown.add(i.id);
      if (i.kind === 'assistant' && i.text) process.stdout.write(`${i.text}\n\n`);
      else if (i.kind === 'tool') process.stdout.write(`  → ${i.name}${i.status === 'error' ? ' (failed)' : ''}\n`);
      else if (i.kind === 'error') { process.stderr.write(`error: ${i.text}\n`); failed = true; }
      else if (i.kind === 'usage' && i.changed?.length) process.stdout.write(`Changed: ${i.changed.join(', ')}\n`);
    }
    if (!s.running) break;
    await new Promise((res) => setTimeout(res, 800));
  }
  process.exitCode = failed ? 1 : 0;
}

async function mergeDriver(a: Args) {
  const [base, ours, theirs, name] = a._;
  if (!base || !ours || !theirs) fail('merge-driver needs <base> <ours> <theirs>');
  const read = async (p: string) => parsePen(await readFile(p, 'utf8'));
  const r = mergeDocs(await read(base), await read(ours), await read(theirs));
  await writeFile(ours, serializePen(r.doc));
  for (const c of r.conflicts) process.stderr.write(`nib merge${name ? ` ${name}` : ''}: ${c}\n`);
  process.exitCode = r.conflicts.length ? 1 : 0;
}

/** Register nib's merge driver in the current git repository: git config, and *.pen in .gitattributes. */
async function gitSetup() {
  let top: string;
  try {
    top = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fail('not in a git repository');
  }
  const self = fileURLToPath(import.meta.url);
  execFileSync('git', ['config', 'merge.nib.name', 'nib: merge .pen designs layer by layer']);
  execFileSync('git', ['config', 'merge.nib.driver', `"${process.execPath}" "${self}" merge-driver %O %A %B %P`]);
  const attrs = join(top, '.gitattributes');
  const text = existsSync(attrs) ? await readFile(attrs, 'utf8') : '';
  if (!/^\*\.pen\s+.*merge=nib/m.test(text)) await writeFile(attrs, `${text}${text && !text.endsWith('\n') ? '\n' : ''}*.pen merge=nib\n`);
  process.stdout.write(`git merges .pen files with nib in ${top} (.gitattributes: *.pen merge=nib).\n`);
}

async function open(a: Args) {
  const path = penFile(a);
  const app = '/Applications/nib.app';
  if (process.platform === 'darwin' && existsSync(app)) { execFile('open', ['-a', app, path]); return; }
  const info = await ensureDaemon();
  const url = `http://127.0.0.1:${info.port}/#${new URLSearchParams({ t: info.token, file: path })}`;
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  execFile(opener, [url]);
  process.stdout.write(`${url}\n`);
}

const args = parseArgs(process.argv.slice(2));
const command = args._.shift();
switch (command) {
  case 'render': await render(args); break;
  case 'export': await render(args, (flag(args, 'format') ?? fail('export needs --format')) as ExportFormat); break;
  case 'validate': await validate(args); break;
  case 'diff': await diff(args); break;
  case 'import': await importFig(args); break;
  case 'agent': await agent(args); break;
  case 'open': await open(args); break;
  case 'merge-driver': await mergeDriver(args); break;
  case 'git-setup': await gitSetup(); break;
  case 'version': case '--version': process.stdout.write('nib 0.1.0\n'); break;
  case undefined: case 'help': case '--help': case '-h': process.stdout.write(HELP); break;
  default: process.stderr.write(`nib: no command "${command}"\n\n${HELP}`); process.exitCode = 2;
}
