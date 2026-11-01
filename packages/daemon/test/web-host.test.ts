import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startWebHost } from '../src/index.ts';

let site: { port: number; close(): Promise<void> };
let base: string;

beforeAll(async () => {
  const root = await mkdtemp(join(tmpdir(), 'nib-web-'));
  const dir = join(root, 'editor');
  await mkdir(join(dir, 'assets'), { recursive: true });
  await writeFile(join(dir, 'index.html'), '<!doctype html><title>nib</title>');
  await writeFile(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  await writeFile(join(root, 'secret.txt'), 'not for the web');
  site = await startWebHost({
    port: 0, editorDir: dir,
    fonts: { load: async (f) => (f.family === 'Inter' ? new Uint8Array([0, 1, 0, 0]) : undefined) },
    icons: { load: async (_l, name) => (name === 'star' ? { viewBox: [0, 0, 24, 24], paths: [] } as never : undefined) },
    fallbacks: { han: ['Noto Sans SC'], fullwidth: ['Noto Sans JP'], hangul: ['Noto Sans KR'], emoji: ['Noto Color Emoji'] },
  });
  base = `http://127.0.0.1:${site.port}`;
});
afterAll(() => site.close());

describe('web host', () => {
  it('says it is the website, and serves fonts and icons', async () => {
    const config = await (await fetch(`${base}/api/config`)).json();
    expect(config).toMatchObject({ web: true, fallbacks: { han: ['Noto Sans SC'] } });
    const font = await fetch(`${base}/api/font?family=Inter&weight=400&italic=0`);
    expect(font.status).toBe(200);
    expect(new Uint8Array(await font.arrayBuffer())).toEqual(new Uint8Array([0, 1, 0, 0]));
    expect((await fetch(`${base}/api/font?family=Nope`)).status).toBe(404);
    expect((await fetch(`${base}/api/icon?library=lucide&name=star`)).status).toBe(200);
  });

  it('runs nothing and opens no files: the rest of the API says it needs the app', async () => {
    for (const [method, path] of [['POST', '/api/execute'], ['POST', '/api/state'], ['GET', '/api/image?doc=/etc/passwd&url=x'], ['GET', '/ws']]) {
      const r = await fetch(`${base}${path}`, { method, ...(method === 'POST' ? { body: '{}' } : {}) });
      expect(r.status, path).toBe(404);
      expect((await r.json()).error, path).toMatch(/needs the nib app/);
    }
  });

  it('serves the editor, with long caching only for its hashed files, and nothing outside it', async () => {
    const asset = await fetch(`${base}/assets/index-abc.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('javascript');
    const page = await fetch(`${base}/some/route`);
    expect(await page.text()).toContain('<title>nib</title>');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const escape = await fetch(`${base}/%2e%2e/secret.txt`);
    expect(await escape.text()).not.toContain('not for the web');
  });
});
