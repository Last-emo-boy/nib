import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { modelSize, Pictures, rank } from '../src/pictures.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/** A network that answers like Openverse (or not at all), Wikimedia Commons and OpenAI, and records what was asked. */
function network(opts: { openverse: 'down' | 'up' }) {
  const asked: { url: string; body?: unknown }[] = [];
  const fetchFn = (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    asked.push({ url, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
    if (url.startsWith('https://api.openverse.org')) {
      if (opts.openverse === 'down') throw new Error('timeout');
      return Response.json({ results: [
        { url: 'https://img.example/tall.jpg', width: 800, height: 1600, title: 'Tall lake', creator: 'Bo', license: 'by', license_version: '4.0', foreign_landing_url: 'https://flickr.example/tall' },
        { url: 'https://img.example/wide.jpg', width: 3000, height: 2000, title: 'Wide lake', creator: 'Ann', license: 'cc0', foreign_landing_url: 'https://flickr.example/wide' },
      ] });
    }
    if (url.startsWith('https://commons.wikimedia.org')) {
      return Response.json({ query: { pages: { 7: { index: 1, title: 'File:Lake at dawn.jpg', imageinfo: [{ url: 'https://upload.example/orig.jpg', width: 4000, height: 3000, thumburl: 'https://upload.example/thumb.jpg', thumbwidth: 1200, thumbheight: 900, mime: 'image/jpeg', descriptionurl: 'https://commons.example/Lake', extmetadata: { LicenseShortName: { value: 'CC BY-SA 4.0' }, Artist: { value: '<a href="x">Cy</a>' } } }] } } } });
    }
    if (url.startsWith('https://api.openai.com')) return Response.json({ data: [{ b64_json: Buffer.from(JPEG).toString('base64') }] });
    return new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  return { fetchFn, asked };
}

describe('pictures', () => {
  it('takes a stock photo of the layer\'s shape from Openverse, credited', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-pictures-'));
    const { fetchFn, asked } = network({ openverse: 'up' });
    const p = new Pictures({ key: async () => undefined, fetch: fetchFn });
    const r = await p.make({ kind: 'stock', prompt: 'Calm lake!', width: 600, height: 400, index: 0 }, dir);
    expect(r.url).toMatch(/^images\/stock-calm-lake-[0-9a-f]{8}\.jpg$/);
    expect(r.credit).toBe('"Wide lake" by Ann, CC0 1.0, https://flickr.example/wide');
    expect(asked.at(-1)!.url).toBe('https://img.example/wide.jpg');
    expect(new Uint8Array(await readFile(join(dir, r.url)))).toEqual(JPEG);
    expect(await readFile(join(dir, 'images', 'CREDITS.md'), 'utf8')).toContain(`- ${r.url.slice(7)}: "Wide lake" by Ann, CC0 1.0`);
    // The next match: the tall one.
    expect((await p.make({ kind: 'stock', prompt: 'Calm lake!', width: 600, height: 400, index: 1 }, dir)).credit).toContain('Tall lake');
    await expect(p.make({ kind: 'stock', prompt: 'Calm lake!', width: 600, height: 400, index: 5 }, dir)).rejects.toThrow('only 2 photos match');
  });

  it('falls back to Wikimedia Commons when Openverse does not answer', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-pictures-'));
    const { fetchFn, asked } = network({ openverse: 'down' });
    const r = await new Pictures({ key: async () => undefined, fetch: fetchFn }).make({ kind: 'stock', prompt: 'lake', width: 600, height: 450, index: 0 }, dir);
    expect(r.credit).toBe('"Lake at dawn" by Cy, CC BY-SA 4.0, https://commons.example/Lake');
    // Commons scales it to twice the layer's width.
    expect(new URL(asked[1].url).searchParams.get('iiurlwidth')).toBe('1200');
    expect(asked.at(-1)!.url).toBe('https://upload.example/thumb.jpg');
  });

  it('makes a picture with the person\'s OpenAI key, or says it needs one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-pictures-'));
    const { fetchFn, asked } = network({ openverse: 'up' });
    await expect(new Pictures({ key: async () => undefined, fetch: fetchFn }).make({ kind: 'image', prompt: 'a fox', width: 800, height: 400, index: 0 }, dir)).rejects.toThrow('needs an OpenAI API key');
    const r = await new Pictures({ key: async () => 'sk-test', fetch: fetchFn, model: 'gpt-image-2.5-flare' }).make({ kind: 'image', prompt: 'a fox', width: 800, height: 400, index: 0 }, dir);
    expect(r.url).toMatch(/^images\/generated-a-fox-[0-9a-f]{8}\.jpg$/);
    expect(asked.at(-1)!.body).toEqual({ model: 'gpt-image-2.5-flare', prompt: 'a fox', size: '1776x880', n: 1, output_format: 'jpeg', output_compression: 90 });
  });

  it('sizes requests for image models and ranks stock photos by fit', () => {
    expect(modelSize(1000, 1000)).toBe('1248x1248');
    expect(modelSize(390, 844)).toBe('848x1840');
    expect(modelSize(3000, 100)).toBe('2176x720');
    const f = (w: number, h: number) => ({ url: `${w}x${h}`, width: w, height: h, credit: { title: '', license: '', source: '' } });
    expect(rank([f(400, 400), f(1600, 900), f(900, 1600)], 800, 450).map((x) => x.url)).toEqual(['1600x900', '400x400', '900x1600']);
  });
});
