/**
 * Vector paths as anchor points with handles, to and from SVG path data: what the pen tool draws and point
 * editing changes. Every SVG command is read (relative ones, quadratic curves and arcs become cubic curves);
 * paths are written with M, L, C and Z only.
 */

export interface Pt { x: number; y: number }

/** An anchor point; `in` and `out` are the handles of the curves arriving at and leaving it (absent: straight). */
export interface PathPoint extends Pt { in?: Pt; out?: Pt }

export interface SubPath { points: PathPoint[]; closed: boolean }

/** [a, b, c, d, e, f]: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG's matrix order). */
export type Matrix = [number, number, number, number, number, number];

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

/** The tokens of path data: command letters and numbers (flags of arcs may run together: "a1 1 0 00 1 1"). */
function tokens(d: string): (string | number)[] {
  const out: (string | number)[] = [];
  let i = 0;
  while (i < d.length) {
    const c = d[i];
    if (/[\s,]/.test(c)) { i++; continue; }
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) { out.push(c); i++; continue; }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) throw new Error(`unexpected "${c}" in path data at ${i}`);
    out.push(Number(m[0]));
    i = NUMBER.lastIndex;
  }
  return out;
}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** SVG path data as subpaths of anchor points. */
export function parsePath(d: string): SubPath[] {
  const t = tokens(d);
  const subs: SubPath[] = [];
  let sub: SubPath | undefined;
  let cur: Pt = { x: 0, y: 0 }, start: Pt = { x: 0, y: 0 };
  // The last control point, for S and T, and which kind of curve set it.
  let lastC: Pt | undefined, lastQ: Pt | undefined;
  let i = 0, cmd = '';
  const num = () => {
    const v = t[i++];
    if (typeof v !== 'number') throw new Error('path data ends in the middle of a command');
    return v;
  };
  const last = () => sub!.points[sub!.points.length - 1];
  const ensure = () => { if (!sub) { sub = { points: [{ ...cur }], closed: false }; subs.push(sub); } };
  const cubic = (c1: Pt, c2: Pt, p: Pt) => {
    ensure();
    last().out = c1;
    sub!.points.push({ x: p.x, y: p.y, in: c2 });
    cur = p;
  };
  const line = (p: Pt) => { ensure(); sub!.points.push({ x: p.x, y: p.y }); cur = p; };
  while (i < t.length) {
    if (typeof t[i] === 'string') cmd = t[i++] as string;
    else if (!cmd) throw new Error('path data must start with a command');
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const at = (x: number, y: number): Pt => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });
    if (lower !== 'z' && typeof t[i] !== 'number') throw new Error(`command ${cmd} needs ${ARGS[lower]} numbers`);
    switch (lower) {
      case 'm': {
        const p = at(num(), num());
        sub = { points: [{ ...p }], closed: false };
        subs.push(sub);
        cur = start = p;
        // Further pairs after a moveto are linetos.
        cmd = rel ? 'l' : 'L';
        lastC = lastQ = undefined;
        continue;
      }
      case 'l': line(at(num(), num())); lastC = lastQ = undefined; break;
      case 'h': { const x = num(); line({ x: rel ? cur.x + x : x, y: cur.y }); lastC = lastQ = undefined; break; }
      case 'v': { const y = num(); line({ x: cur.x, y: rel ? cur.y + y : y }); lastC = lastQ = undefined; break; }
      case 'c': { const c1 = at(num(), num()), c2 = at(num(), num()), p = at(num(), num()); cubic(c1, c2, p); lastC = c2; lastQ = undefined; break; }
      case 's': {
        const c1 = lastC ? { x: 2 * cur.x - lastC.x, y: 2 * cur.y - lastC.y } : { ...cur };
        const c2 = at(num(), num()), p = at(num(), num());
        cubic(c1, c2, p); lastC = c2; lastQ = undefined; break;
      }
      case 'q': { const q = at(num(), num()), p = at(num(), num()); quad(q, p); break; }
      case 't': { const q = lastQ ? { x: 2 * cur.x - lastQ.x, y: 2 * cur.y - lastQ.y } : { ...cur }; quad(q, at(num(), num())); break; }
      case 'a': {
        const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
        const p = at(num(), num());
        for (const [c1, c2, e] of arcToCubics(cur, p, rx, ry, rot, !!large, !!sweep)) cubic(c1, c2, e);
        if (!(rx && ry)) line(p);
        lastC = lastQ = undefined;
        break;
      }
      case 'z': {
        if (sub) {
          sub.closed = true;
          // A last point on the first one is the same point: the closing curve arrives there.
          const pts = sub.points;
          const end = pts[pts.length - 1];
          if (pts.length > 1 && near(end, pts[0])) { pts[0].in = end.in; pts.pop(); }
        }
        cur = start;
        sub = undefined;
        lastC = lastQ = undefined;
        cmd = '';
        continue;
      }
      default: throw new Error(`unknown path command ${cmd}`);
    }
  }
  return subs.filter((s) => s.points.length > 0);

  function quad(q: Pt, p: Pt) {
    const c1 = { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) };
    const c2 = { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) };
    cubic(c1, c2, p);
    lastQ = q;
    lastC = undefined;
  }
}

const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;

/** An elliptical arc (SVG's endpoint form) as cubic curves: [control 1, control 2, end] each. */
function arcToCubics(p0: Pt, p: Pt, rx: number, ry: number, rotDeg: number, large: boolean, sweep: boolean): [Pt, Pt, Pt][] {
  if (!rx || !ry || near(p0, p)) return [];
  rx = Math.abs(rx); ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180, cos = Math.cos(phi), sin = Math.sin(phi);
  const dx = (p0.x - p.x) / 2, dy = (p0.y - p.y) / 2;
  const x1 = cos * dx + sin * dy, y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const sign = large === sweep ? -1 : 1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
  const cx1 = (coef * rx * y1) / ry, cy1 = (-coef * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0.x + p.x) / 2, cy = sin * cx1 + cos * cy1 + (p0.y + p.y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && delta > 0) delta -= 2 * Math.PI;
  if (sweep && delta < 0) delta += 2 * Math.PI;
  const parts = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / parts;
  const k = (4 / 3) * Math.tan(step / 4);
  const point = (a: number): Pt => ({ x: cx + rx * Math.cos(a) * cos - ry * Math.sin(a) * sin, y: cy + rx * Math.cos(a) * sin + ry * Math.sin(a) * cos });
  const deriv = (a: number): Pt => ({ x: -rx * Math.sin(a) * cos - ry * Math.cos(a) * sin, y: -rx * Math.sin(a) * sin + ry * Math.cos(a) * cos });
  const out: [Pt, Pt, Pt][] = [];
  for (let n = 0; n < parts; n++) {
    const a0 = theta + n * step, a1 = a0 + step;
    const s = point(a0), e = n === parts - 1 ? { ...p } : point(a1), d0 = deriv(a0), d1 = deriv(a1);
    out.push([{ x: s.x + k * d0.x, y: s.y + k * d0.y }, { x: e.x - k * d1.x, y: e.y - k * d1.y }, e]);
  }
  return out;
}

const fmt = (v: number, precision: number) => {
  const r = Number(v.toFixed(precision));
  return Object.is(r, -0) ? '0' : String(r);
};

/** Subpaths as SVG path data. */
export function formatPath(subs: SubPath[], precision = 2): string {
  const p = (pt: Pt) => `${fmt(pt.x, precision)} ${fmt(pt.y, precision)}`;
  const parts: string[] = [];
  for (const s of subs) {
    if (!s.points.length) continue;
    const pts = s.points;
    parts.push(`M${p(pts[0])}`);
    const seg = (a: PathPoint, b: PathPoint) => parts.push(a.out || b.in ? `C${p(a.out ?? a)} ${p(b.in ?? b)} ${p(b)}` : `L${p(b)}`);
    for (let i = 1; i < pts.length; i++) seg(pts[i - 1], pts[i]);
    if (s.closed) {
      const a = pts[pts.length - 1], b = pts[0];
      if (pts.length > 1 && (a.out || b.in)) seg(a, b);
      parts.push('Z');
    }
  }
  return parts.join('');
}

export function applyMatrix(m: Matrix, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
}

export function transformPaths(subs: SubPath[], m: Matrix): SubPath[] {
  const t = (p: Pt) => applyMatrix(m, p);
  return subs.map((s) => ({ closed: s.closed, points: s.points.map((p) => ({ ...t(p), ...(p.in ? { in: t(p.in) } : {}), ...(p.out ? { out: t(p.out) } : {}) })) }));
}

/** The exact bounds of the drawn curves (handles do not count, the curves' extremes do). */
export function pathBounds(subs: SubPath[]): { x: number; y: number; width: number; height: number } | undefined {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: Pt) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
  for (const s of subs) {
    const pts = s.points;
    pts.forEach(add);
    const n = s.closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (!a.out && !b.in) continue;
      const c1 = a.out ?? a, c2 = b.in ?? b;
      for (const t of extremes(a.x, c1.x, c2.x, b.x)) add(bezier(a, c1, c2, b, t));
      for (const t of extremes(a.y, c1.y, c2.y, b.y)) add(bezier(a, c1, c2, b, t));
    }
  }
  return x0 === Infinity ? undefined : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function bezier(a: Pt, c1: Pt, c2: Pt, b: Pt, t: number): Pt {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return { x: w[0] * a.x + w[1] * c1.x + w[2] * c2.x + w[3] * b.x, y: w[0] * a.y + w[1] * c1.y + w[2] * c2.y + w[3] * b.y };
}

/** Parameters in (0, 1) where a cubic's coordinate turns. */
function extremes(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3, b = 2 * (p0 - 2 * p1 + p2), c = p1 - p0;
  const ts: number[] = [];
  if (Math.abs(a) < 1e-12) { if (Math.abs(b) > 1e-12) ts.push(-c / b); } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) { const r = Math.sqrt(disc); ts.push((-b + r) / (2 * a), (-b - r) / (2 * a)); }
  }
  return ts.filter((t) => t > 0 && t < 1);
}

/**
 * A path node's subpaths in its own box (0,0 at its top-left, its width and height), from its geometry and
 * viewBox the way the renderer maps them (no viewBox: the geometry's tight bounds fill the box).
 */
export function pathInBox(geometry: string, width: number, height: number, viewBox?: number[]): SubPath[] {
  const subs = parsePath(geometry);
  const [vx, vy, vw, vh] = viewBox?.length === 4 ? viewBox : (() => { const b = pathBounds(subs) ?? { x: 0, y: 0, width: 0, height: 0 }; return [b.x, b.y, b.width, b.height]; })();
  const sx = vw > 0 ? width / vw : 1, sy = vh > 0 ? height / vh : 1;
  return transformPaths(subs, [sx, 0, 0, sy, -vx * sx, -vy * sy]);
}

/**
 * Subpaths in some coordinate space as the props of a path node there: its box is the curves' bounds, its
 * geometry is relative to that box's corner and its viewBox the box itself.
 */
export function pathNodeProps(subs: SubPath[], precision = 2): { x: number; y: number; width: number; height: number; geometry: string; viewBox: [number, number, number, number] } | undefined {
  const b = pathBounds(subs);
  if (!b) return undefined;
  const x = round(b.x, precision), y = round(b.y, precision);
  const width = Math.max(round(b.width, precision), 0.01), height = Math.max(round(b.height, precision), 0.01);
  const geometry = formatPath(transformPaths(subs, [1, 0, 0, 1, -x, -y]), precision);
  return { x, y, width, height, geometry, viewBox: [0, 0, width, height] };
}

const round = (v: number, precision: number) => Number(v.toFixed(precision));
