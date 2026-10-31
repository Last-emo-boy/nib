import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializePen, type PenDocument } from '@nib/format';
import { createNodeRenderer, PackageIconSource } from '@nib/render/node';
import { AgentService } from '../src/agent/service.ts';
import type { Provider, RunRequest } from '../src/agent/types.ts';
import { DocumentHost, startDaemon, type Daemon } from '../src/index.ts';

const none = { load: async () => undefined };
const requests: RunRequest[] = [];
const fake: Provider = {
  id: 'fake',
  info: async () => ({ id: 'fake', name: 'Fake', auth: 'none', available: true, models: [], vision: false }),
  async run(req) { requests.push(req); req.emit({ t: 'text-end', text: 'Done.' }); },
};

let daemon: Daemon, host: DocumentHost, agent: AgentService, dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-variants-'));
  const renderer = await createNodeRenderer();
  host = new DocumentHost({ renderer, images: () => none });
  agent = new AgentService({ home: dir, providers: [fake] });
  daemon = await startDaemon({ host, renderer, agent, fonts: none, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0 });
});
afterAll(async () => { await daemon.close(); host.close(); });

const api = async (path: string, body: unknown) => {
  const r = await fetch(`http://127.0.0.1:${daemon.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

describe('variants', () => {
  it('copies a frame side by side where nothing else is, and starts an agent on each copy', async () => {
    const path = join(dir, 'v.pen');
    await writeFile(path, serializePen({ version: '2.20', children: [
      { type: 'frame', id: 'home', name: 'Home', x: 0, y: 0, width: 400, height: 300, children: [{ type: 'text', id: 't', content: 'Hi' }] },
      { type: 'frame', id: 'block', name: 'In the way', x: 600, y: 100, width: 200, height: 100 },
    ] } as unknown as PenDocument));
    expect((await api('/api/agent/variants', { doc: path, frame: 't', count: 3, provider: 'fake', text: 'x' })).status).toBe(400);
    expect((await api('/api/agent/variants', { doc: path, frame: 'home', count: 5, provider: 'fake', text: 'x' })).status).toBe(400);
    const r = await api('/api/agent/variants', { doc: path, frame: 'home', count: 3, provider: 'fake', text: 'Make it friendlier' });
    expect(r.status).toBe(200);
    const doc = (await host.open(path)).session.doc;
    const copies = doc.data.children.slice(2) as { id: string; name: string; x: number; y: number; children: { id: string }[] }[];
    expect(copies.map((c) => c.name)).toEqual(['Home · Variant 1', 'Home · Variant 2', 'Home · Variant 3']);
    // Right of the frame that was in the way, 120 apart, ids of their own.
    expect(copies.map((c) => [c.x, c.y])).toEqual([[920, 0], [1440, 0], [1960, 0]]);
    expect(new Set(copies.flatMap((c) => [c.id, c.children[0].id])).size).toBe(6);
    expect(r.json.sessions.map((s: { variant: { index: number; frame: string } }) => [s.variant.index, s.variant.frame])).toEqual(copies.map((c, i) => [i, c.id]));
    expect(r.json.sessions[0].title).toBe('Make it friendlier · 1/3');
    for (let i = 0; i < 100 && requests.length < 3; i++) await new Promise((res) => setTimeout(res, 10));
    const byFrame = (id: string) => requests.find((q) => q.prompt.includes(`(id ${id})`))!;
    expect(byFrame(copies[2].id).prompt).toMatch(/^Make it friendlier\n\n<variant>\nMake this as variant 3 of 3, in the frame "Home · Variant 3"/);
    expect(byFrame(copies[0].id).prompt).toContain('Stay closest to the original');
    // The chat shows the person's words; the variant instructions go to the model only.
    const s = await agent.get(r.json.sessions[0].id);
    expect(s!.items[0]).toMatchObject({ kind: 'user', text: 'Make it friendlier', selection: [copies[0].id] });
    // Making the copies is one undo step.
    await host.undo(path);
    expect(doc.data.children.map((n) => n.id)).toEqual(['home', 'block']);
  });
});
