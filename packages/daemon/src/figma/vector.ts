/** Figma's binary path formats as SVG path data. */

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Figma's precomputed geometry (fillGeometry, strokeGeometry): a command byte each (0 close, 1 move,
 * 2 line, 3 quadratic, 4 cubic) followed by its points as little-endian 32-bit floats.
 */
export function commandsPath(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: string[] = [];
  const POINTS: Record<number, [string, number]> = { 1: ['M', 1], 2: ['L', 1], 3: ['Q', 2], 4: ['C', 3] };
  let at = 0;
  while (at < bytes.length) {
    const cmd = bytes[at++];
    if (cmd === 0) { out.push('Z'); continue; }
    const spec = POINTS[cmd];
    if (!spec || at + spec[1] * 8 > bytes.length) break;
    const nums: number[] = [];
    for (let i = 0; i < spec[1] * 2; i++, at += 4) nums.push(r2(view.getFloat32(at, true)));
    out.push(`${spec[0]}${nums.join(' ')}`);
  }
  return out.join(' ');
}

interface Segment { start: number; end: number; ts: [number, number]; te: [number, number] }

/**
 * A vector network (how Figma stores what the pen tool drew): vertices, segments between them with
 * tangents, and regions made of closed loops of segments. Loops become closed subpaths; segments in no
 * loop become open ones, chained where they meet. Coordinates are scaled by `sx`, `sy`.
 */
export function networkPath(bytes: Uint8Array, sx: number, sy: number): { d: string; evenodd: boolean } | undefined {
  if (bytes.length < 12) return undefined;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (i: number) => view.getUint32(i, true), f32 = (i: number) => view.getFloat32(i, true);
  const nv = u32(0), ns = u32(4), nr = u32(8);
  if (12 + nv * 12 + ns * 28 > bytes.length) return undefined;
  let at = 12;
  const verts: [number, number][] = [];
  for (let i = 0; i < nv; i++, at += 12) verts.push([f32(at + 4) * sx, f32(at + 8) * sy]);
  const segs: Segment[] = [];
  for (let i = 0; i < ns; i++, at += 28) segs.push({ start: u32(at + 4), end: u32(at + 16), ts: [f32(at + 8) * sx, f32(at + 12) * sy], te: [f32(at + 20) * sx, f32(at + 24) * sy] });
  const loops: number[][] = [];
  let evenodd = false;
  for (let r = 0; r < nr && at + 8 <= bytes.length; r++) {
    // The low bit of a region's style word is its winding rule: 1 nonzero, 0 even-odd.
    if (!(u32(at) & 1)) evenodd = true;
    const count = u32(at + 4);
    at += 8;
    for (let l = 0; l < count && at + 4 <= bytes.length; l++) {
      const n = u32(at);
      at += 4;
      const loop: number[] = [];
      for (let k = 0; k < n && at + 4 <= bytes.length; k++, at += 4) loop.push(u32(at));
      loops.push(loop);
    }
  }
  if (segs.some((s) => !verts[s.start] || !verts[s.end])) return undefined;
  const p = (v: [number, number]) => `${r2(v[0])} ${r2(v[1])}`;
  const draw = (s: Segment, reversed: boolean) => {
    const [a, b, ta, tb] = reversed ? [s.end, s.start, s.te, s.ts] : [s.start, s.end, s.ts, s.te];
    const from = verts[a], to = verts[b];
    if (!ta[0] && !ta[1] && !tb[0] && !tb[1]) return `L${p(to)}`;
    return `C${p([from[0] + ta[0], from[1] + ta[1]])} ${p([to[0] + tb[0], to[1] + tb[1]])} ${p(to)}`;
  };
  const parts: string[] = [];
  const used = new Set<number>();
  /** A chain of segments, each turned to start where the one before ended. */
  const chain = (list: number[], closed: boolean) => {
    if (!list.length) return;
    const first = segs[list[0]];
    const next = list.length > 1 ? segs[list[1]] : undefined;
    let reversed = !!next && (first.start === next.start || first.start === next.end) && first.end !== next.start && first.end !== next.end;
    let at = reversed ? first.end : first.start;
    const start = at;
    const out = [`M${p(verts[at])}`];
    for (const i of list) {
      const s = segs[i];
      used.add(i);
      reversed = s.start !== at && s.end === at;
      out.push(draw(s, reversed));
      at = reversed ? s.start : s.end;
    }
    // Z draws the last straight line back to the start itself.
    if (closed && at === start && out.length > 2 && out.at(-1) === `L${p(verts[start])}`) out.pop();
    if (closed) out.push('Z');
    parts.push(out.join(' '));
  };
  for (const loop of loops) chain(loop.filter((i) => segs[i]), true);
  // Open strokes: follow segments from vertex to vertex.
  for (let i = 0; i < segs.length; i++) {
    if (used.has(i)) continue;
    const list = [i];
    used.add(i);
    let end = segs[i].end;
    for (let found = true; found;) {
      found = false;
      for (let j = 0; j < segs.length; j++) {
        if (used.has(j) || (segs[j].start !== end && segs[j].end !== end)) continue;
        list.push(j);
        used.add(j);
        end = segs[j].start === end ? segs[j].end : segs[j].start;
        found = true;
        break;
      }
    }
    chain(list, end === segs[i].start && list.length > 1);
  }
  return parts.length ? { d: parts.join(' '), evenodd } : undefined;
}
