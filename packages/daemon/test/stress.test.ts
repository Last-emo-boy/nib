import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializePen, type PenDocument } from '@nib/format';
import { createNodeRenderer, PackageIconSource } from '@nib/render/node';
import { DocumentHost, startDaemon, type Daemon } from '../src/index.ts';
import { stressText } from '../src/stress.ts';

const none = { load: async () => undefined };
let daemon: Daemon, host: DocumentHost, dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-stress-'));
  const renderer = await createNodeRenderer();
  host = new DocumentHost({ renderer, images: () => none });
  daemon = await startDaemon({ host, renderer, fonts: none, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0 });
});
afterAll(async () => { await daemon.close(); host.close(); });

const api = async (path: string, body: unknown) => {
  const r = await fetch(`http://127.0.0.1:${daemon.port}${path}`, { method: 'POST', headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

const text = (id: string, x: number, y: number, content: string, extra: object = {}) => ({ type: 'text', id, x, y, content, fontSize: 14, fill: '$fg', ...extra });

describe('stress test', () => {
  it('rewrites text in another script or length', () => {
    expect([...stressText('Save changes', 'cjk')]).toHaveLength(12);
    expect(stressText('Save changes', 'cjk')).toMatch(/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}、。]+$/u);
    expect(stressText('Pay 42 now', 'long').split(' ')).toHaveLength(3);
    expect(stressText('Pay 42 now', 'long').split(' ')[1]).toBe('42');
    expect(stressText('Save', 'long').length).toBeGreaterThan(10);
    expect(stressText('Save changes', 'rtl')).toMatch(/\p{Script=Arabic}/u);
    expect(stressText('Save', 'dark')).toBe('Save');
  });

  it('copies a frame under itself for each case and reports only what breaks there', async () => {
    const path = join(dir, 's.pen');
    await writeFile(path, serializePen({ version: '2.20', themes: { Mode: ['Light', 'Dark'] }, variables: {
      fg: { type: 'color', value: [{ value: '#111111', theme: { Mode: 'Light' } }, { value: '#333333', theme: { Mode: 'Dark' } }] },
      bg: { type: 'color', value: [{ value: '#FFFFFF', theme: { Mode: 'Light' } }, { value: '#222222', theme: { Mode: 'Dark' } }] },
    }, children: [
      { type: 'frame', id: 'card', name: 'Card', x: 0, y: 0, width: 700, height: 300, fill: '$bg', layout: 'none', children: [
        text('title', 20, 20, 'Settings', { fontSize: 16 }),
        text('tiny', 20, 60, 'Fine print', { fontSize: 9 }),
        { type: 'frame', id: 'btn', name: 'Save', x: 20, y: 100, width: 120, height: 40, fill: '#1C7ED6', layout: 'none', children: [text('label', 10, 10, 'Save changes', { fill: '#FFFFFF' })] },
        text('wide', 400, 20, 'Right side'),
        { type: 'rectangle', id: 'bar', x: 20, y: 200, width: 500, height: 8, fill: '#DDDDDD' },
      ] },
    ] } as unknown as PenDocument));
    expect((await api('/api/stress', { doc: path, frame: 'label' })).status).toBe(400);
    const r = await api('/api/stress', { doc: path, frame: 'card' });
    expect(r.status).toBe(200);
    const doc = (await host.open(path)).session.doc;
    const copies = doc.data.children.slice(1) as { id: string; name: string; x: number; y: number; width: number }[];
    expect(copies.map((c) => c.name)).toEqual(['long text (German)', 'Chinese and Japanese', 'Arabic (right to left)', 'dark theme', 'narrow width'].map((l) => `Card · Stress: ${l}`));
    // In a row under the original, 160 apart; the narrow one at a phone's width.
    expect(copies.map((c) => [c.x, c.y])).toEqual([[0, 460], [860, 460], [1720, 460], [2580, 460], [3440, 460]]);
    expect(copies[4].width).toBe(375);
    const found = (scenario: string) => (r.json.copies as { scenario: string; findings: { kind: string; of: string }[] }[]).find((c) => c.scenario === scenario)!.findings.map((f) => `${f.kind} ${f.of}`);
    expect(found('long')).toContain('overflow label');
    expect(found('cjk')).toContain('overflow label');
    expect(found('dark')).toContain('contrast title');
    expect(found('narrow')).toEqual(['overflow wide', 'overflow bar']);
    // The original's own problem (9px text) is not news on any copy.
    expect(r.json.copies.flatMap((c: { findings: { kind: string }[] }) => c.findings.map((f) => f.kind))).not.toContain('small-text');
    expect(r.json.skipped).toEqual([]);
    // Making the copies is one undo step.
    await host.undo(path);
    expect(doc.data.children.map((n) => n.id)).toEqual(['card']);
  });

  it('skips the dark theme when the document has none', async () => {
    const path = join(dir, 'plain.pen');
    await writeFile(path, serializePen({ version: '2.20', children: [{ type: 'frame', id: 'f', x: 0, y: 0, width: 300, height: 200 }] } as unknown as PenDocument));
    const r = await api('/api/stress', { doc: path, frame: 'f', scenarios: ['dark', 'narrow'] });
    expect(r.json.skipped).toEqual([{ scenario: 'dark', reason: 'the document has no dark theme' }]);
    expect(r.json.copies.map((c: { scenario: string }) => c.scenario)).toEqual(['narrow']);
    expect((await host.open(path)).session.doc.data.children).toHaveLength(2);
  });
});
