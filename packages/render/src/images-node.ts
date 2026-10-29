import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ImageLoader } from './images.ts';

/**
 * Image fills from disk (relative to the .pen file), `data:` urls, and http(s) urls cached on disk.
 */
export class FileImageLoader implements ImageLoader {
  private baseDir: string;
  private cacheDir: string;

  constructor(baseDir: string, cacheDir = path.join(os.homedir(), '.cache', 'nib', 'images')) {
    this.baseDir = baseDir;
    this.cacheDir = cacheDir;
  }

  async load(url: string): Promise<Uint8Array | undefined> {
    if (url.startsWith('data:')) {
      const comma = url.indexOf(',');
      if (comma < 0) return undefined;
      const meta = url.slice(5, comma);
      const body = url.slice(comma + 1);
      return meta.endsWith(';base64') ? new Uint8Array(Buffer.from(body, 'base64')) : new TextEncoder().encode(decodeURIComponent(body));
    }
    if (/^https?:\/\//.test(url)) return this.remote(url);
    const file = url.startsWith('file://') ? new URL(url).pathname : path.resolve(this.baseDir, url);
    try {
      return new Uint8Array(await fs.readFile(file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw err;
    }
  }

  private async remote(url: string): Promise<Uint8Array | undefined> {
    const file = path.join(this.cacheDir, createHash('sha256').update(url).digest('hex'));
    try {
      return new Uint8Array(await fs.readFile(file));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    const res = await fetch(url);
    if (res.status === 404 || res.status === 410) return undefined;
    if (!res.ok) throw new Error(`image ${res.status}: ${url}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    await fs.mkdir(this.cacheDir, { recursive: true });
    await fs.writeFile(file, bytes);
    return bytes;
  }
}
