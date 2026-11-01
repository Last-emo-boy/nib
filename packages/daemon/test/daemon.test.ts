import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOp, buildScene, PenDoc, type Op, type SceneNode } from '@nib/core';
import { parsePen, serializePen, type PenDocument } from '@nib/format';
import { createNodeRenderer, FolderFontLoader, PackageIconSource } from '@nib/render/node';
import { DocumentHost, DRAFTS_DIR, startDaemon, type Daemon } from '../src/index.ts';
import { figFile } from './figma-fixture.ts';

let daemon: Daemon;
let host: DocumentHost;
let dir: string;
const none = { load: async () => undefined };
/** Image urls the host's renders asked for, in order. */
const loads: string[] = [];
const counting = { load: async (url: string) => { loads.push(url); return undefined; } };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-daemon-'));
  const renderer = await createNodeRenderer();
  host = new DocumentHost({ renderer, images: () => counting });
  const projectFonts = new FolderFontLoader(() => host.list().map((d) => join(dirname(d.path), 'fonts')));
  daemon = await startDaemon({ host, renderer, fonts: none, projectFonts, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0, sharesDir: join(dir, 'shares'), shareBind: '127.0.0.1' });
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

  it('restores a document to an earlier snapshot as one undoable change', async () => {
    const file = join(dir, 'restore.pen');
    await writeFile(file, serializePen({ version: '2.20', variables: { a: { type: 'color', value: '#000000' } }, children: [{ type: 'frame', id: 'one', x: 0, y: 0, width: 10, height: 10 }, { type: 'frame', id: 'two', x: 20, y: 0, width: 10, height: 10 }] } as PenDocument));
    const open = await host.open(file);
    const before = structuredClone(open.session.doc.data);
    await host.execute(file, { input: 'Update("one", {width: 50}); Delete("two"); Insert(document, {type: "rectangle", width: 5, height: 5, fill: "#ff0000"}); SetVariables({b: {type: "number", value: 2}})' }, 'agent');
    await host.restore(file, before, { kind: 'user' }, 'Restore');
    expect(parsePen(await readFile(file, 'utf8'))).toEqual(before);
    await host.undo(file);
    expect(parsePen(await readFile(file, 'utf8')).children.map((n) => n.id)).not.toEqual(['one', 'two']);
  });

  it('folds changes with the same merge key into one undo step', async () => {
    const file = join(dir, 'merge.pen');
    await writeFile(file, serializePen({ version: '2.20', children: [{ type: 'frame', id: 'one', x: 0, y: 0, width: 10, height: 10 }] } as PenDocument));
    await host.open(file);
    const user = { kind: 'user' as const };
    await host.edit(file, [{ op: 'set', id: 'one', props: { width: 20 } }], user, 'Resize');
    for (const w of [30, 40, 50]) await host.edit(file, [{ op: 'set', id: 'one', props: { width: w } }], user, 'Drag', 'drag-1');
    await host.edit(file, [{ op: 'set', id: 'one', props: { width: 60 } }], user, 'Drag', 'drag-2');
    const width = async () => (parsePen(await readFile(file, 'utf8')).children[0] as { width: number }).width;
    await host.undo(file);
    expect(await width()).toBe(50);
    await host.undo(file);
    expect(await width()).toBe(20);
    await host.redo(file);
    expect(await width()).toBe(50);
  });

  it('sends undo and redo as ops that replay exactly, however they reuse nodes', async () => {
    // Taking a layer out of a frame and deleting the frame: undoing it puts the frame back, then the layer into it.
    const file = join(dir, 'replay.pen');
    await writeFile(file, serializePen({ version: '2.20', children: [{ type: 'frame', id: 'f', x: 0, y: 0, width: 10, height: 10, children: [{ type: 'rectangle', id: 'r', width: 5, height: 5 }] }] } as PenDocument));
    const ed = await editor(file);
    ed.send({ t: 'edit', path: file, seq: 1, label: 'Unwrap', ops: [{ op: 'remove', parent: 'f', index: 0 }, { op: 'remove', parent: null, index: 0 }, { op: 'insert', parent: null, index: 0, node: { type: 'rectangle', id: 'r', width: 5, height: 5 } }] });
    await ed.next((m) => m.t === 'ops' && m.label === 'Unwrap');
    for (const step of ['undo', 'redo', 'undo']) {
      ed.send({ t: step, path: file });
      await ed.next((m) => m.t === 'ops' && m.label.startsWith(step === 'undo' ? 'Undo' : 'Redo'));
      expect(serializePen(ed.copy().data)).toBe(await readFile(file, 'utf8'));
    }
    expect(ed.copy().data.children).toMatchObject([{ id: 'f', children: [{ id: 'r' }] }]);
    ed.close();
  });

  it('turns a document into a library by renaming it, and keeps editing it there', async () => {
    const file = join(dir, 'kit.pen');
    await writeFile(file, serializePen({ version: '2.20', children: [{ type: 'frame', id: 'k', x: 0, y: 0, width: 10, height: 10, reusable: true }] } as PenDocument));
    await host.open(file);
    const r = await (await api('/api/library/convert', { path: file })).json();
    expect(r.path).toBe(join(dir, 'kit.lib.pen'));
    await host.execute(r.path, { input: 'Update("k", {width: 20})' }, 'agent');
    expect(parsePen(await readFile(r.path, 'utf8')).children[0]).toMatchObject({ width: 20 });
    expect(await stat(file).catch(() => undefined)).toBeUndefined();
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

  it('reloads an image whose bytes changed and tells editors', async () => {
    const file = join(dir, 'snap.pen');
    await writeFile(file, serializePen({ version: '2.20', children: [{ type: 'browser', id: 'web', x: 0, y: 0, width: 320, height: 200, url: 'https://example.com/' }] } as unknown as PenDocument));
    const ed = await editor(file);
    const url = 'nib-browser:web@https://example.com/';
    const shoot = () => host.execute(file, { input: 'TakeScreenshot(["web"])' });
    await shoot();
    const loaded = loads.filter((u) => u === url).length;
    expect(loaded).toBe(1);
    await shoot();
    expect(loads.filter((u) => u === url).length).toBe(1);
    host.assetChanged(file, url);
    expect(await ed.next((m) => m.t === 'asset')).toMatchObject({ url });
    await shoot();
    expect(loads.filter((u) => u === url).length).toBe(2);
    ed.close();
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
  it('starts designs from design systems and uses their components and variables', async () => {
    const get = (p: string) => fetch(`http://127.0.0.1:${daemon.port}${p}`, { headers: { authorization: `Bearer ${daemon.token}` } });
    const { libraries } = await (await get('/api/libraries')).json();
    expect(libraries.map((l: { id: string }) => l.id)).toEqual(expect.arrayContaining(['shadcn', 'heroui']));
    expect(libraries[0]).toMatchObject({ components: expect.any(Number), license: expect.any(String), themes: { Mode: ['Light', 'Dark'] } });
    const thumb = await get('/api/thumbnail?library=heroui&size=240');
    expect(thumb.headers.get('content-type')).toBe('image/png');

    // A new design imports the library from a copy next to it.
    const { path } = await (await api('/api/new', { library: 'shadcn' })).json();
    expect(parsePen(await readFile(path, 'utf8')).imports).toEqual({ shadcn: './libraries/shadcn.lib.pen' });
    expect((await stat(join(dirname(path), 'libraries', 'shadcn.lib.pen'))).isFile()).toBe(true);

    // An agent's instance of a library component expands from the imported document, in either mode.
    const ed = await editor(path);
    const r = await (await api('/api/execute', { filePath: path, input: 'Insert("screen", {type: "ref", ref: "shadcn:button", descendants: {"button-label": {content: "Go"}}})', agent: 'codex' })).json();
    expect(r.ok).toBe(true);
    await ed.next((m) => m.t === 'ops');
    const find = (n: SceneNode, id: string): SceneNode | undefined => (n.id === id ? n : n.children?.map((c) => find(c, id)).find(Boolean));
    const opened = await host.open(path);
    const light = buildScene(opened.session.doc, opened.session.doc.data.children[0], { theme: { Mode: 'Light' } })!;
    const dark = buildScene(opened.session.doc, opened.session.doc.data.children[0], { theme: { Mode: 'Dark' } })!;
    const go = (opened.session.doc.data.children[0] as { children: { id: string }[] }).children[0].id;
    expect(find(light, `${go}/button-label`)).toMatchObject({ content: 'Go', fill: expect.stringMatching(/^#F/i) });
    expect(find(dark, `${go}/button-label`)?.fill).toMatch(/^#[0-3]/);
    expect(light.fill).not.toEqual(dark.fill);
    ed.close();

    // Using a second library in the same design adds an import beside the first.
    expect(await (await api('/api/library/use', { path, id: 'heroui' })).json()).toEqual({ alias: 'heroui', path: './libraries/heroui.lib.pen' });
    expect(parsePen(await readFile(path, 'utf8')).imports).toEqual({ shadcn: './libraries/shadcn.lib.pen', heroui: './libraries/heroui.lib.pen' });
    const preview = await get(`/api/node-preview?doc=${encodeURIComponent(path)}&id=heroui:button&size=120`);
    expect(preview.headers.get('content-type')).toBe('image/png');
  });

  it('saves a dropped image beside the design, under a free name', async () => {
    const path = join(dir, 'assets.pen');
    await writeFile(path, serializePen({ version: '2.20', children: [] } as unknown as PenDocument));
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    expect(await (await api('/api/asset', { path, name: 'My Photo.png', data: png })).json()).toEqual({ url: 'images/My-Photo.png', width: 1, height: 1 });
    expect((await (await api('/api/asset', { path, name: 'My Photo.png', data: png })).json()).url).toBe('images/My-Photo-2.png');
    expect(await readFile(join(dir, 'images', 'My-Photo.png'))).toEqual(Buffer.from(png, 'base64'));
    expect((await api('/api/asset', { path, name: 'x.png', data: Buffer.from('not an image').toString('base64') })).status).toBe(422);
  });

  it('keeps font files beside the design and lists their families', async () => {
    const path = join(dir, 'fonts.pen');
    await writeFile(path, serializePen({ version: '2.20', children: [] } as unknown as PenDocument));
    const ttf = await readFile(join(import.meta.dirname, '..', '..', '..', 'apps', 'editor', 'node_modules', 'lucide-static', 'font', 'lucide.ttf'));
    const r = await (await api('/api/font-file', { path, name: 'lucide.ttf', data: ttf.toString('base64') })).json();
    expect(r).toEqual({ file: 'fonts/lucide.ttf', families: ['lucide'] });
    const list = await (await fetch(`http://127.0.0.1:${daemon.port}/api/fonts?doc=${encodeURIComponent(path)}`, { headers: { authorization: `Bearer ${daemon.token}` } })).json();
    expect(list.project).toEqual([{ family: 'lucide', faces: [{ weight: 400, italic: false }] }]);
    expect((await api('/api/font-file', { path, name: 'x.ttf', data: Buffer.from('not a font').toString('base64') })).status).toBe(422);
  });

  it('shares a read-only snapshot under a stable link, on the local network only when switched on', async () => {
    const path = join(dir, 'deck.pen');
    await writeFile(path, serializePen({ version: '2.20', children: [
      { type: 'frame', id: 'two', name: 'Two', x: 500, y: 0, width: 400, height: 225, fill: '#ff0000' },
      { type: 'frame', id: 'one', name: 'One', x: 0, y: 0, width: 400, height: 225, layout: 'none', fill: '#0000ff', children: [
        { type: 'rectangle', id: 'btn', name: 'Next', x: 20, y: 30, width: 100, height: 40, fill: '#ffffff', metadata: { type: 'nib-link', to: 'two', transition: 'dissolve' } },
      ] },
      { type: 'frame', id: 'c', reusable: true, x: 0, y: 400, width: 10, height: 10 },
    ] } as unknown as PenDocument));
    const r = await (await api('/api/share', { path })).json();
    expect(r.url).toBe(`http://127.0.0.1:${daemon.port}/share/${r.id}/`);
    expect(r.lanUrl).toBeUndefined();
    // No token needed: the id is the permission.
    expect(await (await fetch(r.url)).text()).toContain("fetch('share.json'");
    const manifest = await (await fetch(`${r.url}share.json`)).json();
    expect(manifest.frames.map((f: { id: string }) => f.id)).toEqual(['one', 'two']);
    expect(manifest.frames[0].links).toEqual([{ x: 20, y: 30, width: 100, height: 40, to: 'two', transition: 'dissolve', label: 'Next' }]);
    const png = await fetch(`${r.url}${manifest.frames[0].file}`);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${r.url}..%2Findex.json`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${daemon.port}/share/short/`)).status).toBe(404);
    expect((await (await api('/api/share', { path })).json()).id).toBe(r.id);
    // The local-network server serves shares and nothing else.
    const on = await (await api('/api/share/lan', { on: true })).json();
    expect(on.lan).toBe(true);
    expect((await fetch(`http://127.0.0.1:${on.port}/share/${r.id}/share.json`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${on.port}/api/ping`)).status).toBe(404);
    expect((await (await fetch(`http://127.0.0.1:${daemon.port}/api/share?doc=${encodeURIComponent(path)}`, { headers: { authorization: `Bearer ${daemon.token}` } })).json()).lanUrl).toBe(`http://127.0.0.1:${on.port}/share/${r.id}/`);
    await api('/api/share/lan', { on: false });
    await expect(fetch(`http://127.0.0.1:${on.port}/share/${r.id}/share.json`)).rejects.toThrow();
  });

  it('renames and deletes drafts, and editors that have one open follow', async () => {
    const draft = (await (await api('/api/new', { name: 'Rename me' })).json()).path as string;
    const ed = await editor(draft);
    const r = await (await api('/api/draft/rename', { path: draft, name: 'Landing page' })).json();
    expect(r.path).toBe(join(dirname(draft), 'Landing page.pen'));
    expect(await ed.next((m) => m.t === 'moved')).toMatchObject({ to: r.path });
    expect(await stat(r.path)).toBeTruthy();
    // A name cannot leave the drafts folder: slashes become dashes, and hidden (dot) names are refused.
    expect((await api('/api/draft/rename', { path: r.path, name: '../escape' })).status).toBe(400);
    const inside = (await (await api('/api/draft/rename', { path: r.path, name: 'Q3/Q4 plan' })).json()).path as string;
    expect(inside).toBe(join(dirname(draft), 'Q3-Q4 plan.pen'));
    await ed.next((m) => m.t === 'moved' && m.to === inside);
    expect((await (await api('/api/draft/rename', { path: inside, name: 'Landing page' })).json()).path).toBe(r.path);
    await ed.next((m) => m.t === 'moved' && m.to === r.path);
    // Only drafts: files elsewhere are refused.
    expect((await api('/api/draft/rename', { path: join(dir, 'a.pen'), name: 'x' })).status).toBe(400);
    const other = (await (await api('/api/new', { name: 'Taken' })).json()).path as string;
    expect((await api('/api/draft/rename', { path: other, name: 'Landing page' })).status).toBe(409);
    const del = await (await api('/api/draft/delete', { path: r.path })).json();
    expect(await ed.next((m) => m.t === 'deleted')).toMatchObject({ path: r.path });
    expect(del.trashed).toMatch(/trash\/.* Landing page\.pen$/);
    expect(await stat(del.trashed)).toBeTruthy();
    expect(await stat(r.path).catch(() => undefined)).toBeUndefined();
    const lib = await (await fetch(`http://127.0.0.1:${daemon.port}/api/library`, { headers: { authorization: `Bearer ${daemon.token}` } })).json();
    expect(lib.drafts.some((d: { path: string }) => d.path === r.path)).toBe(false);
    ed.close();
  });

  it('makes a design system from a logo: reads its colors, writes a themed copy beside the design and imports it', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="#0CA678" width="10" height="10"/><rect fill="#0ca678"/><circle fill="#212529"/></svg>';
    const brand = await (await api('/api/brand/read', { image: Buffer.from(svg).toString('base64'), name: 'logo.svg' })).json();
    expect(brand.primary).toBe('#0CA678');
    const path = join(dir, 'brand.pen');
    await writeFile(path, serializePen({ version: '2.20', children: [] } as unknown as PenDocument));
    const r = await (await api('/api/library/brand', { path, base: 'radix', name: 'Acme Green', brand: { primary: brand.primary, radius: 10 } })).json();
    expect(r).toEqual({ alias: 'acme-green', path: './libraries/acme-green.lib.pen' });
    const lib = parsePen(await readFile(join(dir, 'libraries', 'acme-green.lib.pen'), 'utf8'));
    expect((lib.variables!['accent-9'].value as { value: string }[])[0].value).toBe('#0CA678');
    expect(lib.variables!['radius-3'].value).toBe(10);
    expect(await stat(join(dir, 'libraries', 'acme-green.code.json'))).toBeTruthy();
    expect(parsePen(await readFile(path, 'utf8')).imports).toEqual({ 'acme-green': './libraries/acme-green.lib.pen' });
    // The same name again makes a second file rather than overwriting the first.
    expect((await (await api('/api/library/brand', { path, base: 'shadcn', name: 'Acme Green', brand: { primary: '#E8590C' } })).json()).path).toBe('./libraries/acme-green-2.lib.pen');
    expect((await api('/api/library/brand', { path, base: 'nope', brand: { primary: '#E8590C' } })).status).toBe(422);
  });

  it('imports a Figma file beside it, or into the drafts when it is sent', async () => {
    const fig = join(dir, 'Imported.fig');
    await writeFile(fig, figFile());
    const r = await api('/api/import-figma', { path: fig });
    expect(r.status).toBe(200);
    const j = await r.json() as { path: string; layers: number; notes: string[] };
    expect(j.path).toBe(join(dir, 'Imported.pen'));
    expect(parsePen(await readFile(j.path, 'utf8')).children.length).toBeGreaterThan(3);
    const sent = await api('/api/import-figma', { name: 'Sent.fig', data: Buffer.from(figFile()).toString('base64') });
    expect(((await sent.json()) as { path: string }).path).toBe(join(DRAFTS_DIR, 'Sent.pen'));
    expect((await api('/api/import-figma', { path: join(dir, 'notes.txt') })).status).toBe(400);
    expect((await api('/api/import-figma', { name: 'x.fig', data: 'AAAA' })).status).toBe(400);
  });
});
