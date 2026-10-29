/** Minimal sfnt (TrueType/OpenType) reading: split collections and read face names. */

export interface FaceInfo {
  /** Typographic family (name id 16, else 1). */
  family: string;
  /** Typographic subfamily (name id 17, else 2), e.g. "Semibold". */
  subfamily: string;
  /** usWeightClass from OS/2, 400 when absent. */
  weight: number;
  italic: boolean;
}

const tag = (v: DataView, o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));

/** Offsets of the faces inside a font file: one for a plain font, several for a `ttcf` collection. */
export function faceOffsets(bytes: Uint8Array): number[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (tag(v, 0) !== 'ttcf') return [0];
  const n = v.getUint32(8);
  return Array.from({ length: n }, (_, i) => v.getUint32(12 + i * 4));
}

interface TableRecord { tag: string; checksum: number; offset: number; length: number }

function tables(v: DataView, faceOffset: number): TableRecord[] {
  const count = v.getUint16(faceOffset + 4);
  return Array.from({ length: count }, (_, i) => {
    const r = faceOffset + 12 + i * 16;
    return { tag: tag(v, r), checksum: v.getUint32(r + 4), offset: v.getUint32(r + 8), length: v.getUint32(r + 12) };
  });
}

/** A standalone font file for the face at `faceOffset`, with its tables copied out of the collection. */
export function extractFace(bytes: Uint8Array, faceOffset: number): Uint8Array {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (faceOffset === 0 && tag(v, 0) !== 'ttcf') return bytes;
  const recs = tables(v, faceOffset);
  const headerSize = 12 + recs.length * 16;
  const pad = (n: number) => (n + 3) & ~3;
  const total = recs.reduce((s, r) => s + pad(r.length), headerSize);
  const out = new Uint8Array(total);
  const ov = new DataView(out.buffer);
  out.set(bytes.subarray(faceOffset, faceOffset + 12), 0);
  let at = headerSize;
  recs.forEach((r, i) => {
    const rec = 12 + i * 16;
    out.set(bytes.subarray(faceOffset + 12 + i * 16, faceOffset + 12 + i * 16 + 8), rec);
    ov.setUint32(rec + 8, at);
    ov.setUint32(rec + 12, r.length);
    out.set(bytes.subarray(r.offset, r.offset + r.length), at);
    at += pad(r.length);
  });
  return out;
}

/** Family, subfamily, weight and slant of the face at `faceOffset`. */
export function faceInfo(bytes: Uint8Array, faceOffset: number): FaceInfo | undefined {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const recs = tables(v, faceOffset);
  const name = recs.find((r) => r.tag === 'name');
  if (!name) return undefined;
  const names = readNames(v, name.offset);
  const os2 = recs.find((r) => r.tag === 'OS/2');
  const weight = os2 ? v.getUint16(os2.offset + 4) : 400;
  const fsSelection = os2 ? v.getUint16(os2.offset + 62) : 0;
  const family = names.get(16) ?? names.get(1);
  if (!family) return undefined;
  const subfamily = names.get(17) ?? names.get(2) ?? 'Regular';
  return { family, subfamily, weight, italic: (fsSelection & 1) === 1 || /italic|oblique/i.test(subfamily) };
}

/** English names by name id, preferring Windows Unicode records. */
function readNames(v: DataView, at: number): Map<number, string> {
  const count = v.getUint16(at + 2);
  const strings = at + v.getUint16(at + 4);
  const out = new Map<number, string>();
  const rank = new Map<number, number>();
  for (let i = 0; i < count; i++) {
    const r = at + 6 + i * 12;
    const platform = v.getUint16(r), encoding = v.getUint16(r + 2), language = v.getUint16(r + 4);
    const id = v.getUint16(r + 6), length = v.getUint16(r + 8), offset = v.getUint16(r + 10);
    let score = 0;
    if (platform === 3 && (encoding === 1 || encoding === 10) && language === 0x409) score = 3;
    else if (platform === 0) score = 2;
    else if (platform === 1 && encoding === 0 && language === 0) score = 1;
    if (!score || (rank.get(id) ?? 0) >= score) continue;
    const start = strings + offset;
    let s = '';
    if (platform === 1) for (let k = 0; k < length; k++) s += String.fromCharCode(v.getUint8(start + k));
    else for (let k = 0; k + 1 < length; k += 2) s += String.fromCharCode(v.getUint16(start + k));
    out.set(id, s);
    rank.set(id, score);
  }
  return out;
}
