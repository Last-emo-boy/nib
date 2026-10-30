import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { parsePen } from '@nib/format';

const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

/** A client talking to a real `nib-mcp` process over stdio, with its own daemon home and a random port. */
function client(env: Record<string, string>) {
  const proc = spawn(process.execPath, [MAIN], { stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, NIB_PORT: '0', NIB_IDLE_MS: '20000', ...env } });
  const waiting = new Map<number, (msg: any) => void>();
  createInterface({ input: proc.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    waiting.get(msg.id)?.(msg);
  });
  let next = 1;
  const request = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const call = async (name: string, args: Record<string, unknown> = {}) => (await request('tools/call', { name, arguments: args })).result;
  return { request, call, close: () => proc.stdin.end() };
}

describe.each([['through the daemon', false], ['headless', true]])('nib-mcp %s', (_mode, headless) => {
  it('speaks MCP and edits a .pen file on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-mcp-'));
    const file = join(dir, 'design.pen');
    const c = client({ NIB_HOME: join(dir, 'home'), ...(headless ? { NIB_HEADLESS: '1' } : {}) });
    try {
      const init = await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
      expect(init.result.serverInfo.name).toBe('nib');
      expect(init.result.protocolVersion).toBe('2025-06-18');
      const tools = (await c.request('tools/list')).result.tools.map((t: { name: string }) => t.name);
      expect(tools).toEqual(['get_app_state', 'execute', 'read_skill', 'get_style']);

      const run = await c.call('execute', { filePath: file, input: 'card = Insert(document, {type: "frame", name: "Card", x: 0, y: 0, width: 200, height: 120, fill: "#3355ff"})\nTakeScreenshot([card])' });
      expect(run.isError).toBeUndefined();
      expect(run.content[0].text).toMatch(/^OK/);
      expect(run.content[0].text).toContain('Created a new empty document');
      expect(run.content[1]).toMatchObject({ type: 'image', mimeType: 'image/png' });
      const saved = parsePen(await readFile(file, 'utf8'));
      expect(saved.children[0]).toMatchObject({ type: 'frame', name: 'Card', width: 200 });

      const bad = await c.call('execute', { filePath: file, input: 'Update(card, {fill: "blue"})' });
      expect(bad.isError).toBe(true);
      const editId = /`editId`: "(\w+)"/.exec(bad.content[0].text)![1];
      const fixed = await c.call('execute', { filePath: file, editId, edits: [{ find: '"blue"', replace: '"#0000ff"' }] });
      expect(fixed.content[0].text).toMatch(/^OK/);
      expect(parsePen(await readFile(file, 'utf8')).children[0]).toMatchObject({ fill: '#0000ff' });

      // A change made on disk by someone else is picked up before the next snippet.
      const doc = parsePen(await readFile(file, 'utf8'));
      (doc.children[0] as { name: string }).name = 'Renamed';
      await writeFile(file, JSON.stringify(doc, null, 2));
      // Usually the file watch reloads it first; the note still reaches the next call.
      await new Promise((r) => setTimeout(r, 400));
      const state = await c.call('get_app_state');
      expect(state.content[0].text).toContain('"Renamed" 200×120 at (0, 0)');
      expect(state.content[0].text).toContain('changed on disk and was reloaded');
      if (!headless) expect(state.content[0].text).toMatch(/live in the nib editor: http:\/\/127\.0\.0\.1:\d+\/#t=/);

      expect((await c.call('read_skill')).content[0].text).toContain('# Designing with nib');
      expect((await c.call('read_skill', { path: 'execute.md' })).content[0].text).toContain('## Paths');
      expect((await c.call('read_skill', { path: '../package.json' })).isError).toBe(true);
      const styles = (await c.call('get_style')).content[0].text;
      expect(styles).toContain('`saas-clean-light`');
      expect((await c.call('get_style', { name: 'saas-clean-light' })).content[0].text).toContain('#4F46E5');
    } finally {
      c.close();
      const info = await readFile(join(dir, 'home', 'daemon.json'), 'utf8').then(JSON.parse).catch(() => undefined);
      if (info) process.kill(info.pid, 'SIGTERM');
    }
  }, 60_000);
});
