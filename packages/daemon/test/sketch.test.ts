import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DocEditor, PenDoc, addStroke, smoothStroke, type Pt } from '@nib/core';
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

let daemon: Daemon, host: DocumentHost, dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-sketch-'));
  const renderer = await createNodeRenderer();
  host = new DocumentHost({ renderer, images: () => none });
  const agent = new AgentService({ home: dir, providers: [fake] });
  daemon = await startDaemon({ host, renderer, agent, fonts: none, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0 });
});
afterAll(async () => { await daemon.close(); host.close(); });

const segment = (a: Pt, b: Pt, n = 12) => Array.from({ length: n }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
const rect = (x: number, y: number, w: number, h: number) => [...segment({ x, y }, { x: x + w, y }), ...segment({ x: x + w, y }, { x: x + w, y: y + h }), ...segment({ x: x + w, y: y + h }, { x, y: y + h }), ...segment({ x, y: y + h }, { x, y: y + 2 })];
const wave = (x: number, y: number, w: number) => Array.from({ length: 60 }, (_, i) => ({ x: x + (w * i) / 59, y: y + Math.sin(i * 0.9) * 6 }));

describe('sketch', () => {
  it('tells the agent what a selected sketch shows', async () => {
    const doc = new PenDoc({ version: '2.20', children: [] } as unknown as PenDocument);
    const ed = new DocEditor(doc);
    ed.begin();
    const frame = addStroke(ed, doc, smoothStroke(rect(100, 100, 300, 500)), 2);
    addStroke(ed, doc, smoothStroke(wave(130, 140, 150)), 2);
    addStroke(ed, doc, smoothStroke(rect(130, 520, 240, 50)), 2);
    ed.commit();
    const path = join(dir, 's.pen');
    await writeFile(path, serializePen(doc.data));
    const r = await fetch(`http://127.0.0.1:${daemon.port}/api/agent/send`, { method: 'POST', headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ doc: path, provider: 'fake', text: 'Build it', selection: [frame] }) });
    expect(r.status).toBe(200);
    for (let i = 0; i < 100 && !requests.length; i++) await new Promise((res) => setTimeout(res, 10));
    const outline = requests[0].prompt.slice(requests[0].prompt.indexOf('Sketch outline'));
    expect(outline.split('\n').slice(0, 4)).toEqual([
      'Sketch outline (300×500; positions from its top-left corner):',
      '- box 300×500 at (0, 0)',
      '  - scribbled text 150×12 at (30, 34)',
      '  - box 240×50 at (30, 420)',
    ]);
  });
});
