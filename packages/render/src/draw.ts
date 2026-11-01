import type { Canvas, CanvasKit, Paint, Path } from 'canvaskit-wasm';
import type { SceneNode } from '@nib/core';
import type { LayoutResult } from '@nib/layout';
import { parseColor } from './color.ts';
import { fontWeight } from './fonts.ts';
import { cornerRadii, isRectLike, rrectPath, shapePath } from './geometry.ts';
import { isFontIconLibrary, type IconGeometry } from './icons.ts';
import type { ImageStore } from './images.ts';
import { fillList, fillPaint } from './paint.ts';
import { makeShader, type CompiledShader, type ShaderFrame, type ShaderStore } from './shaders.ts';
import { solidTextColor, type TextEngine } from './text.ts';

export type StrokeAlignment = 'inner' | 'center' | 'outer';

export interface DrawContext {
  ck: CanvasKit;
  layout: LayoutResult;
  text: TextEngine;
  images: ImageStore;
  icons: ReadonlyMap<string, IconGeometry | undefined>;
  /** Alignment for strokes that do not set one. */
  defaultStrokeAlignment: StrokeAlignment;
  /** Shader fills and effects; time (seconds) and the pointer (device pixels) for the shaders that use them. */
  shaders?: ShaderStore;
  time?: number;
  pointer?: { x: number; y: number };
}

type Rec = Record<string, unknown>;
const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Image url under which the host provides a browser node's page snapshot; it changes with the page's url. */
export const browserSnapshotUrl = (node: { id: string; url?: unknown }) => `nib-browser:${node.id}@${typeof node.url === 'string' ? node.url : ''}`;

export const iconKey = (library: string, name: string, weight: number | undefined) => `${library}|${name}|${weight ?? ''}`;

interface Shadow { inner: boolean; dx: number; dy: number; blur: number; spread: number; color: Float32Array }

function effects(ck: CanvasKit, node: SceneNode) {
  const list = (Array.isArray(node.effect) ? node.effect : node.effect ? [node.effect] : []) as Rec[];
  const on = list.filter((e) => e && e.enabled !== false);
  const shadows: Shadow[] = on.filter((e) => e.type === 'shadow').map((e) => {
    const off = (e.offset ?? {}) as Rec;
    return {
      inner: e.shadowType === 'inner',
      dx: num(off.x), dy: num(off.y), blur: Math.max(0, num(e.blur)), spread: num(e.spread),
      color: ck.Color4f(...(parseColor(e.color) ?? [0, 0, 0, 0.25])),
    };
  });
  const blur = on.find((e) => e.type === 'blur');
  const backdrop = on.find((e) => e.type === 'background_blur');
  return {
    shadows,
    layerBlur: blur ? Math.max(0, num(blur.radius)) : 0,
    backgroundBlur: backdrop ? Math.max(0, num(backdrop.radius)) : 0,
  };
}

/** Blur radius as a Gaussian sigma, the convention CSS and design tools use. */
const sigma = (radius: number) => radius / 2;

/** What a shader drawn on `node` (w × h) gets besides its inputs, at this point of `canvas`. */
function shaderFrame(dc: DrawContext, canvas: Canvas, node: SceneNode, w: number, h: number): ShaderFrame {
  const { ck } = dc;
  let mouse: { x: number; y: number } | undefined;
  if (dc.pointer) {
    const inv = ck.Matrix.invert(canvas.getTotalMatrix());
    const p = inv && ck.Matrix.mapPoints(inv, [dc.pointer.x, dc.pointer.y]);
    if (p && p[0] >= 0 && p[1] >= 0 && p[0] <= w && p[1] <= h) mouse = { x: p[0], y: p[1] };
  }
  return { width: w, height: h, time: dc.time ?? 0, ...(mouse ? { mouse } : {}), sdf: () => dc.shaders?.sdfShader(w, h, cornerRadii(node), node.type === 'ellipse') };
}

/** The node's enabled shader effects that compiled, in order. */
function shaderEffects(dc: DrawContext, node: SceneNode): { compiled: CompiledShader; uniforms?: Record<string, unknown> }[] {
  if (!dc.shaders) return [];
  const list = (Array.isArray(node.effect) ? node.effect : node.effect ? [node.effect] : []) as Rec[];
  return list.filter((e) => e && e.enabled !== false && e.type === 'shader' && typeof e.url === 'string').flatMap((e) => {
    const compiled = dc.shaders!.get(e.url as string);
    return compiled ? [{ compiled, uniforms: e.uniforms as Record<string, unknown> | undefined }] : [];
  });
}

/** Draw `node` and its subtree. The canvas is in the parent's coordinate space. */
export function drawNode(dc: DrawContext, canvas: Canvas, node: SceneNode): void {
  const { ck } = dc;
  const box = dc.layout.box(node);
  const w = box.width, h = box.height;
  const opacity = Math.min(1, Math.max(0, num(node.opacity, 1)));
  if (opacity === 0) return;
  const fx = effects(ck, node);

  const base = canvas.save();
  canvas.translate(box.x, box.y);
  const rot = num(node.rotation);
  if (rot) canvas.rotate(-rot, 0, 0);
  if (node.flipX === true || node.flipY === true) {
    canvas.translate(node.flipX === true ? w : 0, node.flipY === true ? h : 0);
    canvas.scale(node.flipX === true ? -1 : 1, node.flipY === true ? -1 : 1);
  }
  if (opacity < 1) {
    const p = new ck.Paint();
    p.setAlphaf(opacity);
    canvas.saveLayer(p);
    p.delete();
  }
  if (fx.layerBlur > 0) {
    const p = new ck.Paint();
    const f = ck.ImageFilter.MakeBlur(sigma(fx.layerBlur), sigma(fx.layerBlur), ck.TileMode.Decal, null);
    p.setImageFilter(f);
    canvas.saveLayer(p);
    f.delete();
    p.delete();
  }

  const shaderFx = shaderEffects(dc, node);
  if (shaderFx.length) drawThroughShaders(dc, canvas, node, w, h, fx, shaderFx);
  else drawBody(dc, canvas, node, w, h, fx);
  canvas.restoreToCount(base);
}

/**
 * A node with shader effects: drawn into a picture, which each effect reads as its @source and changes, the
 * last one onto the canvas (as far as the effects' margin around the node).
 */
function drawThroughShaders(dc: DrawContext, canvas: Canvas, node: SceneNode, w: number, h: number, fx: ReturnType<typeof effects>, list: ReturnType<typeof shaderEffects>) {
  const { ck } = dc;
  const m = Math.max(0, ...list.map((e) => e.compiled.parsed.margin));
  const bounds = ck.LTRBRect(-m, -m, w + m, h + m);
  const record = (draw: (c: Canvas) => void) => {
    const rec = new ck.PictureRecorder();
    draw(rec.beginRecording(bounds));
    const pic = rec.finishRecordingAsPicture();
    rec.delete();
    return pic;
  };
  let pic = record((c) => drawBody(dc, c, node, w, h, fx));
  for (const [i, e] of list.entries()) {
    // A picture shader puts the picture's top-left corner (the margin's) at its origin: move it back.
    const frame = { ...shaderFrame(dc, canvas, node, w, h), source: () => pic.makeShader(ck.TileMode.Decal, ck.TileMode.Decal, ck.FilterMode.Linear, ck.Matrix.translated(-m, -m)) };
    const shader = makeShader(ck, e.compiled, e.uniforms, frame);
    const paint = new ck.Paint();
    if (shader) paint.setShader(shader);
    const last = i === list.length - 1;
    if (last) canvas.drawRect(bounds, paint);
    else {
      const next = record((c) => c.drawRect(bounds, paint));
      pic.delete();
      pic = next;
    }
    paint.delete();
    shader?.delete();
  }
  pic.delete();
}

/** The node's own paint (shadows, fills, text, children, strokes), in its local space. */
function drawBody(dc: DrawContext, canvas: Canvas, node: SceneNode, w: number, h: number, fx: ReturnType<typeof effects>) {
  const { ck } = dc;
  const outline = shapePath(ck, node, w, h);
  const filled = outline !== undefined && fillList(node.fill).length > 0;
  // Nodes without a filled outline cast shadows from what they paint.
  const layerShadows = filled ? [] : fx.shadows.filter((s) => !s.inner);
  for (const s of layerShadows) {
    const p = new ck.Paint();
    const f = ck.ImageFilter.MakeDropShadow(s.dx, s.dy, sigma(s.blur), sigma(s.blur), s.color, null);
    p.setImageFilter(f);
    canvas.saveLayer(p);
    f.delete();
    p.delete();
  }

  if (outline) {
    if (filled) for (const s of fx.shadows) if (!s.inner) outerShadow(dc, canvas, node, outline, w, h, s);
    if (fx.backgroundBlur > 0) backgroundBlur(dc, canvas, outline, fx.backgroundBlur);
    paintFills(dc, canvas, node.fill, outline, w, h, node);
    // A browser node shows the latest snapshot of its page over a neutral placeholder.
    if (node.type === 'browser') paintFills(dc, canvas, ['#F1F3F5', { type: 'image', url: browserSnapshotUrl(node), mode: 'cover' }], outline, w, h);
    for (const s of fx.shadows) if (s.inner) innerShadow(dc, canvas, node, outline, w, h, s);
  }

  switch (node.type) {
    case 'text': drawText(dc, canvas, node, w, h); break;
    case 'icon': drawIcon(dc, canvas, node, w, h); break;
    case 'note': case 'prompt': case 'context': drawNoteText(dc, canvas, node, w, h); break;
  }

  if (node.children?.length) {
    const clip = node.type === 'frame' && node.clip === true && outline;
    const save = canvas.save();
    if (clip) canvas.clipPath(outline, ck.ClipOp.Intersect, true);
    for (const child of node.children) drawNode(dc, canvas, child);
    canvas.restoreToCount(save);
  }

  if (outline) paintStrokes(dc, canvas, node, outline, w, h);
  outline?.delete();
}

function paintFills(dc: DrawContext, canvas: Canvas, fill: unknown, path: Path, w: number, h: number, node?: SceneNode) {
  const shaderFill = (f: Rec) => {
    const compiled = node && typeof f.url === 'string' ? dc.shaders?.get(f.url) : undefined;
    return compiled ? makeShader(dc.ck, compiled, f.uniforms as Record<string, unknown> | undefined, shaderFrame(dc, canvas, node!, w, h)) : undefined;
  };
  for (const f of fillList(fill)) {
    const p = fillPaint(dc.ck, f, { width: w, height: h }, dc.images, shaderFill);
    if (!p) continue;
    canvas.drawPath(path, p);
    p.delete();
  }
}

/** Grow a node's outline by `d` on every side (negative shrinks). Rect-like outlines keep their corner shape. */
function grown(dc: DrawContext, node: SceneNode, path: Path, w: number, h: number, d: number): Path {
  const { ck } = dc;
  if (isRectLike(node)) {
    const r = cornerRadii(node).map((x) => (x > 0 ? Math.max(0, x + d) : 0));
    return rrectPath(ck, -d, -d, w + d, h + d, r.map((x) => [x, x] as [number, number]));
  }
  const copy = path.copy();
  if (d === 0) return copy;
  const stroked = path.makeStroked({ width: Math.abs(d) * 2, join: ck.StrokeJoin.Round });
  if (!stroked) return copy;
  const out = ck.Path.MakeFromOp(copy, stroked, d > 0 ? ck.PathOp.Union : ck.PathOp.Difference) ?? copy.copy();
  copy.delete();
  stroked.delete();
  return out;
}

function outerShadow(dc: DrawContext, canvas: Canvas, node: SceneNode, path: Path, w: number, h: number, s: Shadow) {
  const { ck } = dc;
  const save = canvas.save();
  canvas.clipPath(path, ck.ClipOp.Difference, true);
  const shape = grown(dc, node, path, w, h, s.spread);
  const p = new ck.Paint();
  p.setAntiAlias(true);
  p.setColor(s.color);
  if (s.blur > 0) p.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, sigma(s.blur), true));
  canvas.translate(s.dx, s.dy);
  canvas.drawPath(shape, p);
  p.delete();
  shape.delete();
  canvas.restoreToCount(save);
}

function innerShadow(dc: DrawContext, canvas: Canvas, node: SceneNode, path: Path, w: number, h: number, s: Shadow) {
  const { ck } = dc;
  const save = canvas.save();
  canvas.clipPath(path, ck.ClipOp.Intersect, true);
  const hole = grown(dc, node, path, w, h, -s.spread);
  const pad = s.blur * 3 + Math.abs(s.dx) + Math.abs(s.dy) + Math.abs(s.spread) + 1;
  const outer = new ck.PathBuilder().addRect(ck.LTRBRect(-pad - s.dx, -pad - s.dy, w + pad - s.dx, h + pad - s.dy)).detachAndDelete();
  const ring = ck.Path.MakeFromOp(outer, hole, ck.PathOp.Difference);
  const p = new ck.Paint();
  p.setAntiAlias(true);
  p.setColor(s.color);
  if (s.blur > 0) p.setMaskFilter(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, sigma(s.blur), true));
  canvas.translate(s.dx, s.dy);
  if (ring) canvas.drawPath(ring, p);
  p.delete();
  ring?.delete();
  outer.delete();
  hole.delete();
  canvas.restoreToCount(save);
}

function backgroundBlur(dc: DrawContext, canvas: Canvas, path: Path, radius: number) {
  const { ck } = dc;
  const save = canvas.save();
  canvas.clipPath(path, ck.ClipOp.Intersect, true);
  const f = ck.ImageFilter.MakeBlur(sigma(radius), sigma(radius), ck.TileMode.Clamp, null);
  canvas.saveLayer(undefined, null, f);
  canvas.restoreToCount(save);
  f.delete();
}

interface Sides { top: number; right: number; bottom: number; left: number }

function strokeSides(v: unknown): Sides | undefined {
  if (typeof v === 'number') return v > 0 ? { top: v, right: v, bottom: v, left: v } : undefined;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Rec;
    const s = { top: num(o.top), right: num(o.right), bottom: num(o.bottom), left: num(o.left) };
    return s.top || s.right || s.bottom || s.left ? s : undefined;
  }
  return undefined;
}

/**
 * Strokes paint a region: for rect-like nodes the ring between the outline grown and shrunk according to
 * the alignment (which also gives per-side widths), for other shapes a stroked outline clipped inside or
 * outside it.
 */
function paintStrokes(dc: DrawContext, canvas: Canvas, node: SceneNode, path: Path, w: number, h: number) {
  const fills = fillList(node.stroke);
  if (!fills.length) return;
  const sides = strokeSides(node.strokeWidth ?? 1);
  if (!sides) return;
  const { ck } = dc;
  const align: StrokeAlignment = node.strokeAlignment ?? dc.defaultStrokeAlignment;
  const out = align === 'outer' ? 1 : align === 'center' ? 0.5 : 0;
  let region: Path | undefined;
  let strokePaint: ((p: Paint) => void) | undefined;
  let clipOp: 'in' | 'out' | undefined;
  if (isRectLike(node)) {
    const r = cornerRadii(node);
    const o = { top: sides.top * out, right: sides.right * out, bottom: sides.bottom * out, left: sides.left * out };
    const i = { top: sides.top - o.top, right: sides.right - o.right, bottom: sides.bottom - o.bottom, left: sides.left - o.left };
    const grow = (rad: number, a: number, b: number): [number, number] => (rad > 0 ? [Math.max(0, rad + a), Math.max(0, rad + b)] : [0, 0]);
    const outer = rrectPath(ck, -o.left, -o.top, w + o.right, h + o.bottom, [
      grow(r[0], o.left, o.top), grow(r[1], o.right, o.top), grow(r[2], o.right, o.bottom), grow(r[3], o.left, o.bottom),
    ]);
    const inner = rrectPath(ck, i.left, i.top, w - i.right, h - i.bottom, [
      grow(r[0], -i.left, -i.top), grow(r[1], -i.right, -i.top), grow(r[2], -i.right, -i.bottom), grow(r[3], -i.left, -i.bottom),
    ]);
    region = ck.Path.MakeFromOp(outer, inner, ck.PathOp.Difference) ?? undefined;
    outer.delete();
    inner.delete();
  } else {
    const width = sides.top;
    const closed = node.type !== 'path' || /z\s*$/i.test(String(node.geometry ?? ''));
    const effective = closed ? align : 'center';
    strokePaint = (p) => {
      p.setStyle(ck.PaintStyle.Stroke);
      p.setStrokeWidth(effective === 'center' ? width : width * 2);
      p.setStrokeCap(node.strokeLinecap === 'round' ? ck.StrokeCap.Round : node.strokeLinecap === 'square' ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
      p.setStrokeJoin(node.strokeLinejoin === 'round' ? ck.StrokeJoin.Round : node.strokeLinejoin === 'bevel' ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter);
      if (node.type === 'polygon' && num(node.cornerRadius) > 0) p.setPathEffect(ck.PathEffect.MakeCorner(num(node.cornerRadius)));
    };
    clipOp = effective === 'inner' ? 'in' : effective === 'outer' ? 'out' : undefined;
  }
  const save = canvas.save();
  if (clipOp) canvas.clipPath(path, clipOp === 'in' ? ck.ClipOp.Intersect : ck.ClipOp.Difference, true);
  for (const f of fills) {
    const p = fillPaint(ck, f, { width: w, height: h }, dc.images);
    if (!p) continue;
    if (strokePaint) strokePaint(p);
    canvas.drawPath(region ?? path, p);
    p.delete();
  }
  canvas.restoreToCount(save);
  region?.delete();
}

function drawText(dc: DrawContext, canvas: Canvas, node: SceneNode, w: number, h: number) {
  const growth = node.textGrowth ?? 'auto';
  const fills = fillList(node.fill);
  if (!fills.length) return;
  const solid = solidTextColor(node.fill);
  const fancy = fills.find((f) => typeof f === 'object' && (f as Rec).type !== 'color');
  let paint: Paint | undefined;
  if (fancy) paint = fillPaint(dc.ck, fancy, { width: w, height: h }, dc.images);
  if (!solid && !paint) return;
  let dy = 0;
  if (growth === 'fixed-width-height') {
    const free = h - dc.text.layout(node, w).height;
    dy = node.textAlignVertical === 'middle' ? free / 2 : node.textAlignVertical === 'bottom' ? free : 0;
  }
  dc.text.draw(canvas, node, w, dy, paint);
  paint?.delete();
}

function drawIcon(dc: DrawContext, canvas: Canvas, node: SceneNode, w: number, h: number) {
  const { ck } = dc;
  const library = String(node.library ?? 'lucide');
  const name = String(node.icon ?? '');
  const weight = typeof node.weight === 'number' ? node.weight : undefined;
  const fills = fillList(node.fill);
  if (!name || !fills.length) return;
  if (isFontIconLibrary(library)) {
    const size = Math.min(w, h);
    const glyph = { ...node, type: 'text', textGrowth: 'fixed-width', content: name, fontFamily: library, fontSize: size, fontWeight: String(weight ?? 400), textAlign: 'center', lineHeight: 1 } as SceneNode;
    dc.text.draw(canvas, glyph, w, (h - dc.text.layout(glyph, w).height) / 2);
    return;
  }
  const geo = dc.icons.get(iconKey(library, name, weight));
  if (!geo) return;
  const [vx, vy, vw, vh] = geo.viewBox;
  const s = Math.min(w / vw, h / vh);
  const save = canvas.save();
  canvas.translate((w - vw * s) / 2, (h - vh * s) / 2);
  canvas.scale(s, s);
  canvas.translate(-vx, -vy);
  for (const shape of geo.shapes) {
    const path = ck.Path.MakeFromSVGString(shape.d);
    if (!path) continue;
    for (const f of fills) {
      const p = fillPaint(ck, f, { width: vw, height: vh }, dc.images);
      if (!p) continue;
      if (shape.opacity < 1) p.setAlphaf(p.getColor()[3] * shape.opacity);
      if (shape.fill) canvas.drawPath(path, p);
      if (shape.stroke) {
        p.setStyle(ck.PaintStyle.Stroke);
        p.setStrokeWidth(geo.strokeWidth);
        p.setStrokeCap(geo.linecap === 'round' ? ck.StrokeCap.Round : geo.linecap === 'square' ? ck.StrokeCap.Square : ck.StrokeCap.Butt);
        p.setStrokeJoin(geo.linejoin === 'round' ? ck.StrokeJoin.Round : geo.linejoin === 'bevel' ? ck.StrokeJoin.Bevel : ck.StrokeJoin.Miter);
        canvas.drawPath(path, p);
      }
      p.delete();
    }
    path.delete();
  }
  canvas.restoreToCount(save);
}

/** Sticky notes, prompts and context cards: a tinted card with wrapped text. */
const CARD_TINTS: Record<string, string> = { note: '#FFF1A8', prompt: '#E9E2FF', context: '#DFF0FF' };
export const CARD_PADDING = 16;

function drawNoteText(dc: DrawContext, canvas: Canvas, node: SceneNode, w: number, h: number) {
  const { ck } = dc;
  const bg = new ck.Paint();
  bg.setAntiAlias(true);
  bg.setColor(ck.Color4f(...(parseColor(CARD_TINTS[node.type]) ?? [1, 1, 1, 1])));
  canvas.drawRRect(ck.RRectXY(ck.LTRBRect(0, 0, w, h), 6, 6), bg);
  bg.delete();
  const text = { ...node, type: 'text', textGrowth: 'fixed-width', fill: node.fill ?? '#1F1F1F', fontSize: node.fontSize ?? 14, fontWeight: String(fontWeight(node.fontWeight)) } as SceneNode;
  const save = canvas.save();
  canvas.clipRect(ck.LTRBRect(0, 0, w, h), ck.ClipOp.Intersect, true);
  canvas.translate(CARD_PADDING, CARD_PADDING);
  dc.text.draw(canvas, text, Math.max(0, w - CARD_PADDING * 2), 0);
  canvas.restoreToCount(save);
}
