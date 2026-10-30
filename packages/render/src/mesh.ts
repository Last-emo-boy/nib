import type { CanvasKit, Shader } from 'canvaskit-wasm';
import { parseColor, withAlpha, type RGBA } from './color.ts';

/**
 * Mesh gradients: a grid of `columns` × `rows` points in the node's unit box, each with a color and optional
 * control points (absolute, in the same unit box) that bend the patch edges leaving it. Each patch between four
 * points is a Coons patch with Bézier edges; colors blend smoothly across patches (bicubic). The mesh is
 * tessellated into colored triangles and drawn into a picture, used as the fill's shader.
 */

type P = [number, number];
interface Point { at: P; left?: P; right?: P; top?: P; bottom?: P }

export interface Mesh { columns: number; rows: number; points: Point[]; colors: RGBA[] }

const isPair = (v: unknown): v is P => Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'number' && Number.isFinite(x));

/** The mesh of a fill, with the grid filled in where points or colors are missing. Undefined without colors. */
export function meshOf(f: Record<string, unknown>): Mesh | undefined {
  const columns = Math.max(2, Math.min(16, Math.round(Number(f.columns) || 2)));
  const rows = Math.max(2, Math.min(16, Math.round(Number(f.rows) || 2)));
  const given = (Array.isArray(f.colors) ? f.colors : []).map(parseColor);
  const known = given.filter((c): c is RGBA => !!c);
  if (!known.length) return undefined;
  const raw = Array.isArray(f.points) ? f.points : [];
  const points: Point[] = [];
  const colors: RGBA[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const i = r * columns + c;
      const grid: P = [c / (columns - 1), r / (rows - 1)];
      const v = raw[i] as unknown;
      if (isPair(v)) points.push({ at: v });
      else if (v && typeof v === 'object' && isPair((v as { position?: unknown }).position)) {
        const o = v as Record<string, unknown>;
        points.push({ at: o.position as P, ...(isPair(o.leftHandle) ? { left: o.leftHandle } : {}), ...(isPair(o.rightHandle) ? { right: o.rightHandle } : {}), ...(isPair(o.topHandle) ? { top: o.topHandle } : {}), ...(isPair(o.bottomHandle) ? { bottom: o.bottomHandle } : {}) });
      } else points.push({ at: grid });
      colors.push(given[i] ?? known[i % known.length]);
    }
  }
  return { columns, rows, points, colors };
}

const lerp = (a: P, b: P, t: number): P => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function cubic(a: P, c1: P, c2: P, b: P, t: number): P {
  const u = 1 - t;
  const w0 = u * u * u, w1 = 3 * u * u * t, w2 = 3 * u * t * t, w3 = t * t * t;
  return [w0 * a[0] + w1 * c1[0] + w2 * c2[0] + w3 * b[0], w0 * a[1] + w1 * c1[1] + w2 * c2[1] + w3 * b[1]];
}

/** A position on the mesh: patch (c, r) at (u, v) in 0..1. */
export function meshPosition(m: Mesh, c: number, r: number, u: number, v: number): P {
  const at = (cc: number, rr: number) => m.points[rr * m.columns + cc];
  const p00 = at(c, r), p10 = at(c + 1, r), p01 = at(c, r + 1), p11 = at(c + 1, r + 1);
  // Edges without control points are straight: their controls sit a third of the way along.
  const horizontal = (a: Point, b: Point, t: number) => cubic(a.at, a.right ?? lerp(a.at, b.at, 1 / 3), b.left ?? lerp(b.at, a.at, 1 / 3), b.at, t);
  const vertical = (a: Point, b: Point, t: number) => cubic(a.at, a.bottom ?? lerp(a.at, b.at, 1 / 3), b.top ?? lerp(b.at, a.at, 1 / 3), b.at, t);
  const top = horizontal(p00, p10, u), bottom = horizontal(p01, p11, u);
  const left = vertical(p00, p01, v), right = vertical(p10, p11, v);
  const corner = (k: 0 | 1) => (1 - u) * (1 - v) * p00.at[k] + u * (1 - v) * p10.at[k] + (1 - u) * v * p01.at[k] + u * v * p11.at[k];
  return [0, 1].map((k) => (1 - v) * top[k] + v * bottom[k] + (1 - u) * left[k] + u * right[k] - corner(k as 0 | 1)) as P;
}

/** The color at patch (c, r), (u, v): Catmull-Rom across the grid on both axes, kept within 0..1. */
export function meshColor(m: Mesh, c: number, r: number, u: number, v: number): RGBA {
  const col = (cc: number, rr: number) => m.colors[Math.max(0, Math.min(m.rows - 1, rr)) * m.columns + Math.max(0, Math.min(m.columns - 1, cc))];
  const cr = (a: number, b: number, c2: number, d: number, t: number) => 0.5 * (2 * b + (-a + c2) * t + (2 * a - 5 * b + 4 * c2 - d) * t * t + (-a + 3 * b - 3 * c2 + d) * t * t * t);
  const out = [0, 0, 0, 0] as RGBA;
  for (let k = 0; k < 4; k++) {
    const rowAt = (rr: number) => cr(col(c - 1, rr)[k], col(c, rr)[k], col(c + 1, rr)[k], col(c + 2, rr)[k], u);
    out[k] = Math.max(0, Math.min(1, cr(rowAt(r - 1), rowAt(r), rowAt(r + 1), rowAt(r + 2), v)));
  }
  return out;
}

/** Subdivisions of each patch on each axis. */
const STEPS = 14;

/** A shader drawing the mesh over a box of `width` × `height` (the node's local space). */
export function meshShader(ck: CanvasKit, f: Record<string, unknown>, width: number, height: number, opacity: number): Shader | undefined {
  const m = meshOf(f);
  if (!m || width <= 0 || height <= 0) return undefined;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r < m.rows - 1; r++) {
    for (let c = 0; c < m.columns - 1; c++) {
      const base = positions.length / 2;
      for (let j = 0; j <= STEPS; j++) {
        for (let i = 0; i <= STEPS; i++) {
          const [x, y] = meshPosition(m, c, r, i / STEPS, j / STEPS);
          positions.push(x * width, y * height);
          colors.push(...withAlpha(meshColor(m, c, r, i / STEPS, j / STEPS), opacity));
        }
      }
      for (let j = 0; j < STEPS; j++) {
        for (let i = 0; i < STEPS; i++) {
          const a = base + j * (STEPS + 1) + i, b = a + 1, d = a + STEPS + 1, e = d + 1;
          indices.push(a, b, e, a, e, d);
        }
      }
    }
  }
  const verts = ck.MakeVertices(ck.VertexMode.Triangles, positions, null, Float32Array.from(colors), indices, false);
  const rec = new ck.PictureRecorder();
  const canvas = rec.beginRecording(ck.LTRBRect(0, 0, width, height));
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  // Vertex colors alone (no shader): blend them as the source.
  canvas.drawVertices(verts, ck.BlendMode.Dst, paint);
  paint.delete();
  verts.delete();
  const picture = rec.finishRecordingAsPicture();
  rec.delete();
  const shader = picture.makeShader(ck.TileMode.Clamp, ck.TileMode.Clamp, ck.FilterMode.Linear, undefined, ck.LTRBRect(0, 0, width, height));
  picture.delete();
  return shader;
}
