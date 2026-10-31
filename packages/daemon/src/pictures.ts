import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PictureRequest } from '@nib/exec';

/**
 * Pictures for Generate: stock photos, openly licensed, from Openverse (and Wikimedia Commons when Openverse
 * does not answer), with no key; or pictures an image model makes with the person's OpenAI key. Each is saved
 * in an `images` folder next to the .pen file, and stock photos are credited in its CREDITS.md.
 */

type Fetch = typeof fetch;
export interface Credit { title: string; creator?: string; license: string; source: string }
interface Found { url: string; width: number; height: number; credit: Credit }

const UA = 'nib/0.1 (+https://github.com/Last-emo-boy/nib)';
const MAX_BYTES = 15 * 1024 * 1024;

const strip = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

/** Openverse's license codes as people write them: "by" 4.0 → "CC BY 4.0". */
function licenseName(code: string, version?: string): string {
  if (code === 'pdm') return 'Public Domain Mark';
  if (code === 'cc0') return 'CC0 1.0';
  return `CC ${code.toUpperCase()}${version ? ` ${version}` : ''}`;
}

/** Openverse: openly licensed images from many collections, most relevant first. */
export async function openverse(query: string, fetchFn: Fetch): Promise<Found[]> {
  const u = new URL('https://api.openverse.org/v1/images/');
  u.searchParams.set('q', query);
  u.searchParams.set('page_size', '20');
  u.searchParams.set('mature', 'false');
  const r = await fetchFn(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`Openverse answered ${r.status}`);
  const j = (await r.json()) as { results?: { url?: string; width?: number; height?: number; title?: string; creator?: string; license?: string; license_version?: string; foreign_landing_url?: string }[] };
  return (j.results ?? []).filter((x) => x.url && x.width && x.height && x.license).map((x) => ({
    url: x.url!, width: x.width!, height: x.height!,
    credit: { title: x.title || 'Untitled', ...(x.creator ? { creator: x.creator } : {}), license: licenseName(x.license!, x.license_version), source: x.foreign_landing_url || x.url! },
  }));
}

/** Wikimedia Commons: freely licensed photos, scaled by Commons to `width`, most relevant first. */
export async function commons(query: string, width: number, fetchFn: Fetch): Promise<Found[]> {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'query', format: 'json', generator: 'search', gsrsearch: `${query} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|size|extmetadata|mime', iiurlwidth: String(width), origin: '*' })) u.searchParams.set(k, v);
  const r = await fetchFn(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`Wikimedia Commons answered ${r.status}`);
  type Info = { url: string; width: number; height: number; thumburl?: string; thumbwidth?: number; thumbheight?: number; mime: string; descriptionurl?: string; extmetadata?: Record<string, { value?: string }> };
  const j = (await r.json()) as { query?: { pages?: Record<string, { index?: number; title: string; imageinfo?: Info[] }> } };
  return Object.values(j.query?.pages ?? {}).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).flatMap((p) => {
    const ii = p.imageinfo?.[0];
    if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime)) return [];
    const m = ii.extmetadata ?? {};
    const license = m.LicenseShortName?.value;
    if (!license) return [];
    const creator = m.Artist?.value ? strip(m.Artist.value) : undefined;
    return [{
      url: ii.thumburl ?? ii.url, width: ii.thumbwidth ?? ii.width, height: ii.thumbheight ?? ii.height,
      credit: { title: strip(m.ObjectName?.value ?? p.title.replace(/^File:/, '').replace(/\.\w+$/, '')), ...(creator ? { creator } : {}), license: strip(license), source: ii.descriptionurl ?? ii.url },
    }];
  });
}

/** Matches in the order to use them: relevant, the shape of the layer, and large enough for it. */
export function rank(found: Found[], width: number, height: number): Found[] {
  const want = Math.log(width / height);
  return found.map((f, i) => ({ f, score: i * 0.05 + Math.abs(Math.log(f.width / f.height) - want) + (f.width < width || f.height < height ? 0.5 : 0) }))
    .sort((a, b) => a.score - b.score).map((x) => x.f);
}

/** A size an image model accepts for a layer of this shape: sides in multiples of 16, about 1.5 megapixels. */
export function modelSize(width: number, height: number): string {
  const aspect = Math.min(3, Math.max(1 / 3, width / height));
  const h = Math.sqrt(1_572_864 / aspect), w = h * aspect;
  const r16 = (v: number) => Math.max(256, Math.round(v / 16) * 16);
  return `${r16(w)}x${r16(h)}`;
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'picture';
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 8);

export class Pictures {
  private fetch: Fetch;
  private key: () => Promise<string | undefined>;
  private model: string;
  /** Until when Openverse is skipped, after it failed to answer (it can be out of reach for a while). */
  private openverseDownUntil = 0;

  constructor(opts: { key: () => Promise<string | undefined>; fetch?: Fetch; model?: string }) {
    this.fetch = opts.fetch ?? fetch;
    this.key = opts.key;
    this.model = opts.model ?? process.env.NIB_IMAGE_MODEL ?? 'gpt-image-2.5-flare';
  }

  /** Whether pictures can be made (the person has given an OpenAI key); stock photos need none. */
  async canMake(): Promise<boolean> {
    return !!(await this.key());
  }

  /** The picture for `req`, saved under `dir/images`; its url relative to `dir`. */
  async make(req: PictureRequest, dir: string): Promise<{ url: string; credit?: string }> {
    return req.kind === 'stock' ? this.stock(req, dir) : this.generated(req, dir);
  }

  private async stock(req: PictureRequest, dir: string): Promise<{ url: string; credit?: string }> {
    // Twice the layer's size, for sharp pictures on high-density screens.
    const width = Math.min(2400, req.width * 2), height = Math.min(2400, req.height * 2);
    let found: Found[] = [];
    if (Date.now() >= this.openverseDownUntil) {
      try {
        found = await openverse(req.prompt, this.fetch);
      } catch {
        // Openverse can be slow or out of reach: Commons, which it draws from too, for the next 10 minutes.
        this.openverseDownUntil = Date.now() + 10 * 60_000;
      }
    }
    if (!found.length) found = await commons(req.prompt, width, this.fetch);
    // Openverse gives originals: very large ones take long to fetch and fill the folder.
    const pick = rank(found.filter((f) => f.width <= 6000), width, height)[req.index];
    if (!pick) throw new Error(found.length ? `only ${found.length} photos match "${req.prompt}"` : `no stock photo matches "${req.prompt}": try other words`);
    const r = await this.fetch(pick.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`could not download the photo (${r.status})`);
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error('the photo is too large: try index 1 for the next match');
    const type = r.headers.get('content-type') ?? '';
    const ext = /png/.test(type) || /\.png$/i.test(pick.url) ? 'png' : /webp/.test(type) || /\.webp$/i.test(pick.url) ? 'webp' : 'jpg';
    const name = `stock-${slug(req.prompt)}-${hash(pick.url)}.${ext}`;
    await this.save(dir, name, bytes);
    const c = pick.credit;
    const credit = `"${c.title}"${c.creator ? ` by ${c.creator}` : ''}, ${c.license}, ${c.source}`;
    await this.credit(dir, name, credit);
    return { url: `images/${name}`, credit };
  }

  private async generated(req: PictureRequest, dir: string): Promise<{ url: string }> {
    const key = await this.key();
    if (!key) throw new Error('making pictures needs an OpenAI API key: add one in nib (agent panel, settings), or use "stock" for a stock photo');
    const r = await this.fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: req.prompt, size: modelSize(req.width, req.height), n: 1, output_format: 'jpeg', output_compression: 90 }),
      signal: AbortSignal.timeout(240_000),
    });
    const j = (await r.json().catch(() => ({}))) as { data?: { b64_json?: string }[]; error?: { message?: string } };
    if (!r.ok) throw new Error(`the image model answered: ${j.error?.message ?? r.status}`);
    const b64 = j.data?.[0]?.b64_json;
    if (!b64) throw new Error('the image model sent no picture');
    const name = `generated-${slug(req.prompt)}-${hash(`${req.prompt}|${req.index}|${req.width}x${req.height}`)}.jpg`;
    await this.save(dir, name, new Uint8Array(Buffer.from(b64, 'base64')));
    return { url: `images/${name}` };
  }

  private async save(dir: string, name: string, bytes: Uint8Array): Promise<void> {
    await mkdir(join(dir, 'images'), { recursive: true });
    await writeFile(join(dir, 'images', name), bytes);
  }

  /** One line per photo in images/CREDITS.md, so the design can say where its photos come from. */
  private async credit(dir: string, name: string, credit: string): Promise<void> {
    const file = join(dir, 'images', 'CREDITS.md');
    const text = await readFile(file, 'utf8').catch(() => '# Image credits\n\nStock photos in this folder, with their licenses.\n\n');
    if (text.includes(`- ${name}:`)) return;
    await writeFile(file, `${text}- ${name}: ${credit}\n`);
  }
}
