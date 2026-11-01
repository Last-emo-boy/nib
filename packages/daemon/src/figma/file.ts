import { inflateRawSync, zstdDecompressSync } from 'node:zlib';
import { decodeMessage, decodeSchema, type KiwiSchema } from './kiwi.ts';

/**
 * A Figma file: a zip holding canvas.fig (the document, in kiwi) and images/<sha1> (the pictures), or
 * the bare canvas data as older files and the clipboard have it.
 */
export interface FigFile { schema: KiwiSchema; message: Record<string, unknown>; images: Map<string, Uint8Array>; meta?: Record<string, unknown> }

/** The entries of a zip archive (stored or deflated). */
export function readZip(buf: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error('not a zip archive');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const out = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('zip: broken central directory');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true), extraLen = view.getUint16(at + 30, true), commentLen = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
    const data = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = buf.subarray(data, data + size);
    if (!name.endsWith('/')) out.set(name, method === 8 ? new Uint8Array(inflateRawSync(raw)) : method === 0 ? raw.slice() : (() => { throw new Error(`zip: ${name} uses compression method ${method}`); })());
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];
const inflate = (chunk: Uint8Array): Uint8Array => (ZSTD.every((b, i) => chunk[i] === b) ? new Uint8Array(zstdDecompressSync(chunk)) : new Uint8Array(inflateRawSync(chunk)));

/** The kiwi canvas data: "fig-kiwi", a version, then length-prefixed chunks (the schema, then the message). */
export function readCanvas(buf: Uint8Array): { schema: KiwiSchema; message: Record<string, unknown> } {
  const magic = new TextDecoder().decode(buf.subarray(0, 8));
  if (magic !== 'fig-kiwi' && magic !== 'fig-jam.') throw new Error('not a Figma file');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const chunks: Uint8Array[] = [];
  for (let at = 12; at + 4 <= buf.length;) {
    const n = view.getUint32(at, true);
    chunks.push(buf.subarray(at + 4, at + 4 + n));
    at += 4 + n;
  }
  if (chunks.length < 2) throw new Error('the Figma file has no document in it');
  const schema = decodeSchema(inflate(chunks[0]));
  return { schema, message: decodeMessage(schema, inflate(chunks[1]), 'Message') };
}

export function readFig(buf: Uint8Array): FigFile {
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const entries = readZip(buf);
    const canvas = entries.get('canvas.fig') ?? [...entries].find(([k]) => k.endsWith('.fig'))?.[1];
    if (!canvas) throw new Error('the archive has no canvas.fig');
    const images = new Map([...entries].filter(([k]) => k.startsWith('images/')).map(([k, v]) => [k.slice(7), v]));
    const meta = entries.get('meta.json');
    return { ...readCanvas(canvas), images, ...(meta ? { meta: JSON.parse(new TextDecoder().decode(meta)) } : {}) };
  }
  return { ...readCanvas(buf), images: new Map() };
}
