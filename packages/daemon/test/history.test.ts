import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializePen, type PenDocument } from '@nib/format';
import { createNodeRenderer, PackageIconSource } from '@nib/render/node';
import { DocumentHost, startDaemon, type Daemon } from '../src/index.ts';

const none = { load: async () => undefined };
let daemon: Daemon, host: DocumentHost, dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-history-'));
  const renderer = await createNodeRenderer();
  host = new DocumentHost({ renderer, images: () => none, recents: false });
  daemon = await startDaemon({ host, renderer, fonts: none, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0 });
});
afterAll(async () => { await daemon.close(); host.close(); });

const api = async (path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${daemon.port}${path}`, body === undefined ? { headers: { authorization: `Bearer ${daemon.token}` } } : { method: 'POST', headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};
const page = (fill: string) => serializePen({ version: '2.20', children: [{ type: 'frame', id: 'home', name: 'Home', x: 0, y: 0, width: 40, height: 40, fill }] } as unknown as PenDocument);

describe('history', () => {
  it('lists the commits that changed a design and pictures what changed since one', async () => {
    const file = join(dir, 'site.pen');
    const git = (...a: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { encoding: 'utf8' });
    git('init', '-q');
    await writeFile(file, page('#FF0000'));
    git('add', 'site.pen'); git('commit', '-qm', 'red');
    await writeFile(file, page('#0000FF'));
    await host.open(file);
    const { json } = await api(`/api/git/commits?doc=${encodeURIComponent(file)}`);
    expect(json.commits.map((c: { subject: string }) => c.subject)).toEqual(['red']);
    const d = await api('/api/git/diff', { doc: file, ref: json.commits[0].hash });
    expect(d.json.diff.frames).toEqual([{ id: 'home', name: 'Home', kind: 'changed', layers: [{ id: 'home', name: 'Home', type: 'frame', kind: 'changed', props: ['fill'] }] }]);
    const p = d.json.pictures.home;
    expect(p.before && p.after && p.diff).toBeTruthy();
    expect(p.similarity).toBeLessThan(0.5);
    // The version from git is gone again: only the document itself is open.
    expect(host.list().map((o) => o.path)).toEqual([file]);
    expect((await api('/api/git/diff', { doc: file, ref: 'nope; rm -rf' })).status).toBe(400);
  });
});
