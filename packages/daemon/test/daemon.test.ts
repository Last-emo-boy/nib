import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOp, PenDoc, type Op } from '@nib/core';
import { parsePen, serializePen, type PenDocument } from '@nib/format';
import { createNodeRenderer, PackageIconSource } from '@nib/render/node';
import { DocumentHost, startDaemon, type Daemon } from '../src/index.ts';

let daemon: Daemon;
let host: DocumentHost;
let dir: string;
const none = { load: async () => undefined };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-daemon-'));
  const renderer = await createNodeRenderer();
  host = new DocumentHost({ renderer, images: () => none });
  daemon = await startDaemon({ host, renderer, fonts: none, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0 });
});
afterAll(async () => {
  await daemon.close();
  host.close();
});

/** An editor connection that keeps its own copy of the document from the messages it receives. */
async function editor(path: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws?t=${daemon.token}`);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const messages: any[] = [];
  const waiters: [(m: any) => boolean, (m: any) => void][] = [];
  let copy: PenDoc | undefined;
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.t === 'doc' || m.t === 'reload') copy = new PenDoc(m.data);
    if (m.t === 'ops') for (const op of m.ops as Op[]) applyOp(copy!, op);
    messages.push(m);
    for (const w of waiters.splice(0)) if (w[0](m)) w[1](m); else waiters.push(w);
  };
  const next = (pred: (m: any) => boolean) => new Promise<any>((resolve) => {
    const seen = messages.find(pred);
    if (seen) { messages.splice(messages.indexOf(seen), 1); resolve(seen); } else waiters.push([pred, (m) => { messages.splice(messages.indexOf(m), 1); resolve(m); }]);
  });
  const send = (m: unknown) => ws.send(JSON.stringify(m));
  send({ t: 'open', path });
  await next((m) => m.t === 'doc');
  return { send, next, copy: () => copy!, close: () => ws.close() };
}

const api = (path: string, body: unknown, token = daemon.token) => fetch(`http://127.0.0.1:${daemon.port}${path}`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

describe('daemon', () => {
  it('streams agent changes to editors and applies editor edits as undoable changes', async () => {
    const file = join(dir, 'a.pen');
    await writeFile(file, serializePen({ version: '2.20', children: [{ type: 'frame', id: 'root', x: 0, y: 0, width: 100, height: 100 }] } as PenDocument));
    const ed = await editor(file);

    // An agent's snippet reaches the editor as ops.
    const r = await (await api('/api/execute', { filePath: file, input: 'Insert("root", {type: "rectangle", name: "R", width: 10, height: 10, fill: "#ff0000"})', agent: 'claude-code' })).json();
    expect(r.ok).toBe(true);
    const agentOps = await ed.next((m) => m.t === 'ops');
    expect(agentOps.source).toEqual({ kind: 'agent', name: 'claude-code' });
    expect(serializePen(ed.copy().data)).toBe(await readFile(file, 'utf8'));

    // The editor's own edit is saved, echoed back, and undoable.
    ed.send({ t: 'edit', path: file, seq: 1, label: 'Resize', ops: [{ op: 'set', id: 'root', props: { width: 200 } }] });
    expect(await ed.next((m) => m.t === 'ack')).toMatchObject({ seq: 1, ok: true });
    await ed.next((m) => m.t === 'ops' && m.label === 'Resize');
    expect(parsePen(await readFile(file, 'utf8')).children[0]).toMatchObject({ width: 200 });
    expect((await ed.next((m) => m.t === 'history' && m.undo.length === 2)).undo).toEqual(['claude-code: execute', 'Resize']);

    ed.send({ t: 'undo', path: file });
    await ed.next((m) => m.t === 'ops' && m.label === 'Undo Resize');
    expect(parsePen(await readFile(file, 'utf8')).children[0]).toMatchObject({ width: 100 });
    expect(serializePen(ed.copy().data)).toBe(await readFile(file, 'utf8'));

    // An edit that does not apply changes nothing and resends the document.
    ed.send({ t: 'edit', path: file, seq: 2, ops: [{ op: 'set', id: 'gone', props: { width: 1 } }] });
    expect(await ed.next((m) => m.t === 'ack' && m.seq === 2)).toMatchObject({ ok: false });
    await ed.next((m) => m.t === 'doc');
    ed.close();
  });

  it('reloads a document that changed on disk and tells editors', async () => {
    const file = join(dir, 'b.pen');
    await writeFile(file, serializePen({ version: '2.20', children: [] } as unknown as PenDocument));
    const ed = await editor(file);
    await writeFile(file, serializePen({ version: '2.20', children: [{ type: 'frame', id: 'x', x: 0, y: 0, width: 5, height: 5 }] } as PenDocument));
    const reload = await ed.next((m) => m.t === 'reload');
    expect(reload.data.children[0].id).toBe('x');
    ed.close();
  });

  it('refuses requests without the token, from other hosts or from web pages', async () => {
    expect((await api('/api/state', {}, 'wrong')).status).toBe(401);
    const base = `http://127.0.0.1:${daemon.port}/api/state`;
    const headers = { authorization: `Bearer ${daemon.token}` };
    expect((await fetch(base, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' } })).status).toBe(403);
    // DNS rebinding: a page on evil.example resolving to 127.0.0.1 sends its own Host header.
    const status = await new Promise((resolve) => {
      request({ host: '127.0.0.1', port: daemon.port, path: '/api/state', method: 'POST', headers: { ...headers, host: `evil.example:${daemon.port}` } }, (res) => { res.resume(); resolve(res.statusCode); }).end();
    });
    expect(status).toBe(421);
    await expect(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws?t=wrong`);
      ws.onopen = () => resolve('open');
      ws.onerror = () => reject(new Error('refused'));
    })).rejects.toThrow('refused');
  });

  it('serves icons and says which fallback fonts to use', async () => {
    const get = (p: string) => fetch(`http://127.0.0.1:${daemon.port}${p}`, { headers: { authorization: `Bearer ${daemon.token}` } });
    const icon = await (await get('/api/icon?library=lucide&name=check')).json();
    expect(icon.viewBox).toEqual([0, 0, 24, 24]);
    expect((await get('/api/icon?library=lucide&name=no-such-icon')).status).toBe(404);
    expect((await (await get('/api/config')).json()).fallbacks.han.length).toBeGreaterThan(0);
  });
});

describe('library', () => {
  it('lists templates, makes drafts from them, and renders thumbnails', async () => {
    const get = (p: string) => fetch(`http://127.0.0.1:${daemon.port}${p}`, { headers: { authorization: `Bearer ${daemon.token}` } });
    const { templates } = await (await get('/api/templates')).json();
    expect(templates.length).toBeGreaterThanOrEqual(96);
    expect(templates[0]).toMatchObject({ id: expect.any(String), title: { en: expect.any(String), zh: expect.any(String) } });
    const r = await (await api('/api/new', { template: 'analytics-metric-card', name: 'Metric card' })).json();
    expect(r.path).toMatch(/drafts\/Metric card( \d+)?\.pen$/);
    const thumb = await get(`/api/thumbnail?path=${encodeURIComponent(r.path)}&size=200`);
    expect(thumb.headers.get('content-type')).toBe('image/png');
    expect((await thumb.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const lib = await (await get('/api/library')).json();
    expect(lib.drafts.some((d: { path: string }) => d.path === r.path)).toBe(true);
  });
});
