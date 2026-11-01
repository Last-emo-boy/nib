import type { BlendMode as CkBlendMode, CanvasKit, Image, InputMatrix, Paint, Shader } from 'canvaskit-wasm';
import { parseColor, withAlpha, type RGBA } from './color.ts';
import type { ImageStore } from './images.ts';
import { meshShader } from './mesh.ts';

type Rec = Record<string, unknown>;

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Fills (or strokes) in paint order, without disabled ones. A bare string is a color. */
export function fillList(v: unknown): unknown[] {
  const list = Array.isArray(v) ? v : v === undefined || v === null ? [] : [v];
  return list.filter((f) => !(f && typeof f === 'object' && (f as Rec).enabled === false));
}

export function blendMode(ck: CanvasKit, mode: unknown): CkBlendMode {
  const B = ck.BlendMode;
  switch (mode) {
    case 'darken': return B.Darken;
    case 'multiply': return B.Multiply;
    case 'colorBurn': case 'linearBurn': return B.ColorBurn;
    case 'light': return B.Lighten;
    case 'screen': return B.Screen;
    case 'linearDodge': return B.Plus;
    case 'colorDodge': return B.ColorDodge;
    case 'overlay': return B.Overlay;
    case 'softLight': return B.SoftLight;
    case 'hardLight': return B.HardLight;
    case 'difference': return B.Difference;
    case 'exclusion': return B.Exclusion;
    case 'hue': return B.Hue;
    case 'saturation': return B.Saturation;
    case 'color': return B.Color;
    case 'luminosity': return B.Luminosity;
    default: return B.SrcOver;
  }
}

export interface PaintBox { width: number; height: number }

/**
 * A paint for one fill, in the node's local space (0,0 at its top-left). Undefined when the fill paints
 * nothing (unknown type, missing image). The caller deletes the paint.
 */
export function fillPaint(ck: CanvasKit, fill: unknown, box: PaintBox, images: ImageStore, shaderFill?: (f: Rec) => Shader | undefined): Paint | undefined {
  const paint = new ck.Paint();
  paint.setAntiAlias(true);
  if (typeof fill === 'string') {
    const c = parseColor(fill);
    if (!c) return discard(paint);
    paint.setColor(ck.Color4f(...c));
    return paint;
  }
  if (!fill || typeof fill !== 'object') return discard(paint);
  const f = fill as Rec;
  paint.setBlendMode(blendMode(ck, f.blendMode));
  const opacity = Math.min(1, Math.max(0, num(f.opacity, 1)));
  let shader: Shader | undefined;
  switch (f.type) {
    case 'color': {
      const c = parseColor(f.color);
      if (!c) return discard(paint);
      paint.setColor(ck.Color4f(...c));
      return paint;
    }
    case 'gradient': shader = gradientShader(ck, f, box, opacity); break;
    case 'image': {
      const img = typeof f.url === 'string' ? images.get(f.url) : undefined;
      if (img) shader = imageShader(ck, img, f, box);
      if (shader) paint.setAlphaf(opacity);
      break;
    }
    case 'mesh_gradient': shader = meshShader(ck, f, box.width, box.height, opacity); break;
    case 'shader': {
      shader = shaderFill?.(f);
      if (shader) paint.setAlphaf(opacity);
      break;
    }
  }
  if (!shader) return discard(paint);
  paint.setShader(shader);
  shader.delete();
  return paint;
}

function discard(p: Paint): undefined {
  p.delete();
  return undefined;
}

/**
 * Gradient geometry is defined in the node's unit box (0..1 on both axes) and stretched to its size.
 * `rotation` is counter-clockwise degrees with 0 pointing up; linear length is `size.height`;
 * radial and angular use `size` as the ellipse's diameters.
 */
function gradientShader(ck: CanvasKit, f: Rec, box: PaintBox, opacity: number): Shader | undefined {
  const stops = (Array.isArray(f.colors) ? f.colors : [])
    .map((s) => s as Rec)
    .map((s) => ({ c: parseColor(s.color), p: num(s.position, 0) }))
    .filter((s): s is { c: RGBA; p: number } => !!s.c)
    .sort((a, b) => a.p - b.p);
  if (stops.length === 0) return undefined;
  if (stops.length === 1) stops.push({ ...stops[0], p: 1 });
  const colors = stops.map((s) => ck.Color4f(...withAlpha(s.c, opacity)));
  const pos = stops.map((s) => Math.min(1, Math.max(0, s.p)));
  const center = (f.center ?? {}) as Rec;
  const size = (f.size ?? {}) as Rec;
  const cx = num(center.x, 0.5), cy = num(center.y, 0.5);
  const sw = num(size.width, 1), sh = num(size.height, 1);
  const theta = (num(f.rotation, 0) * Math.PI) / 180;
  const M = ck.Matrix;
  const toBox = M.scaled(box.width, box.height);
  const kind = f.gradientType ?? 'linear';
  if (kind === 'linear') {
    const dx = -Math.sin(theta) * sh / 2, dy = -Math.cos(theta) * sh / 2;
    return ck.Shader.MakeLinearGradient([cx - dx, cy - dy], [cx + dx, cy + dy], colors, pos, ck.TileMode.Clamp, toBox);
  }
  const ellipse = M.multiply(toBox, M.translated(cx, cy), M.rotated(-theta), M.scaled(sw / 2, sh / 2));
  if (kind === 'radial') return ck.Shader.MakeRadialGradient([0, 0], 1, colors, pos, ck.TileMode.Clamp, ellipse);
  // Angular: starts pointing up and runs clockwise.
  return ck.Shader.MakeSweepGradient(0, 0, colors, pos, ck.TileMode.Clamp, M.multiply(ellipse, M.rotated(-Math.PI / 2)));
}

/**
 * An image fill as it shows in a `width` × `height` layer (its mode and crop applied), as pixels: for
 * tracing or cutting out what the layer shows. Undefined when the image cannot be read.
 */
export function fillPixels(ck: CanvasKit, bytes: Uint8Array, fill: Rec, width: number, height: number): { width: number; height: number; rgba: Uint8Array } | undefined {
  const img = ck.MakeImageFromEncoded(bytes);
  if (!img) return undefined;
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const surface = ck.MakeSurface(w, h);
  if (!surface) { img.delete(); return undefined; }
  try {
    const shader = imageShader(ck, img, fill, { width: w, height: h });
    if (!shader) return undefined;
    const paint = new ck.Paint();
    paint.setShader(shader);
    const c = surface.getCanvas();
    c.clear(ck.TRANSPARENT);
    c.drawRect(ck.LTRBRect(0, 0, w, h), paint);
    paint.delete();
    shader.delete();
    const snap = surface.makeImageSnapshot();
    const rgba = snap.readPixels(0, 0, { width: w, height: h, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
    snap.delete();
    return rgba ? { width: w, height: h, rgba: rgba as Uint8Array } : undefined;
  } finally {
    img.delete();
    surface.delete();
  }
}

/**
 * Image fill. `mode` fits the (optionally cropped) image into the node: cover/fill crops to fill it,
 * contain/fit shows it whole, stretch distorts it. `transform` maps normalized image coordinates into
 * the crop's unit box.
 */
function imageShader(ck: CanvasKit, img: Image, f: Rec, box: PaintBox): Shader | undefined {
  const iw = img.width(), ih = img.height();
  if (!iw || !ih || box.width <= 0 || box.height <= 0) return undefined;
  const M = ck.Matrix;
  const t = Array.isArray(f.transform) && f.transform.length === 6 ? (f.transform as number[]) : [1, 0, 0, 1, 0, 0];
  // Crop space <- normalized image space.
  const crop = [t[0], t[2], t[4], t[1], t[3], t[5], 0, 0, 1];
  const inv = M.invert(crop);
  if (!inv) return undefined;
  // Size of the crop region in image pixels.
  const cw = iw * Math.hypot(inv[0], inv[3]);
  const ch = ih * Math.hypot(inv[1], inv[4]);
  const mode = f.mode ?? 'cover';
  let sx: number, sy: number;
  if (mode === 'stretch') { sx = box.width / cw; sy = box.height / ch; }
  else {
    const s = mode === 'contain' || mode === 'fit' ? Math.min(box.width / cw, box.height / ch) : Math.max(box.width / cw, box.height / ch);
    sx = sy = s;
  }
  const ox = (box.width - cw * sx) / 2, oy = (box.height - ch * sy) / 2;
  const local: InputMatrix = M.multiply(
    M.translated(ox, oy),
    M.scaled(cw * sx, ch * sy),
    crop,
    M.scaled(1 / iw, 1 / ih),
  );
  const tile = mode === 'contain' || mode === 'fit' ? ck.TileMode.Decal : ck.TileMode.Clamp;
  return img.makeShaderOptions(tile, tile, ck.FilterMode.Linear, ck.MipmapMode.Linear, local);
}
