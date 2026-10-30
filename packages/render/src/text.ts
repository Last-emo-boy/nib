import type { Canvas, CanvasKit, Paint, Paragraph, ParagraphStyle, TextStyle } from 'canvaskit-wasm';
import type { SceneNode } from '@nib/core';
import type { Size2, TextMeasurer } from '@nib/layout';
import { parseColor, type RGBA } from './color.ts';
import { fontWeight, isItalic, type FontFace, type FontStore } from './fonts.ts';

export const DEFAULT_FAMILY = 'Inter';

/** Families tried, in order, for scripts the node's own font usually lacks. */
export interface FallbackFamilies {
  han: string[];
  /** Fullwidth forms (U+FF00-FFEF: ： ？ ！ （ ）...). Their glyph position differs between CJK locales. */
  fullwidth: string[];
  hangul: string[];
  emoji: string[];
  /** Arrows, math, technical symbols and shapes (⌘ ⇧ ⌥ → ≠ ▲ ✓), which UI fonts often lack. */
  symbols?: string[];
}

export const NOTO_FALLBACKS: Required<FallbackFamilies> = {
  han: ['Noto Sans SC'], fullwidth: ['Noto Sans SC'], hangul: ['Noto Sans KR'], emoji: ['Noto Color Emoji'],
  symbols: ['Noto Sans Symbols 2', 'Noto Sans Math'],
};

const SCRIPTS: [RegExp, keyof FallbackFamilies][] = [
  [/[\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/, 'han'],
  [/[\uff00-\uffef]/, 'fullwidth'],
  [/[\uac00-\ud7af\u1100-\u11ff]/, 'hangul'],
  [/\p{Extended_Pictographic}/u, 'emoji'],
  [/[\u2190-\u23ff\u2400-\u243f\u2500-\u27bf\u27f0-\u27ff\u2900-\u297f\u2b00-\u2bff]/, 'symbols'],
];

/** Text content as a string (numbers from number variables included). */
export const textOf = (node: SceneNode) => (node.content === undefined || node.content === null ? '' : String(node.content));

export function familyOf(node: SceneNode): string {
  return typeof node.fontFamily === 'string' && node.fontFamily ? node.fontFamily : DEFAULT_FAMILY;
}

export function fallbackFamilies(text: string, fb: FallbackFamilies): string[] {
  return SCRIPTS.filter(([re]) => re.test(text)).flatMap(([, script]) => fb[script] ?? []);
}

/** Font faces a text-like node needs, fallbacks included. */
export function facesOf(node: SceneNode, fb: FallbackFamilies): FontFace[] {
  const weight = fontWeight(node.fontWeight);
  const italic = isItalic(node.fontStyle);
  return [familyOf(node), ...fallbackFamilies(textOf(node), fb)].map((family) => ({ family, weight, italic }));
}

/** First visible solid color among the fills; text without one is not painted. */
export function solidTextColor(fill: unknown): RGBA | undefined {
  const list = Array.isArray(fill) ? fill : fill === undefined ? [] : [fill];
  let color: RGBA | undefined;
  for (const f of list) {
    if (typeof f === 'string') color = parseColor(f) ?? color;
    else if (f && typeof f === 'object' && (f as { enabled?: unknown }).enabled !== false && (f as { type?: unknown }).type === 'color') {
      color = parseColor((f as { color?: unknown }).color) ?? color;
    }
  }
  return color;
}

const TRANSPARENT: RGBA = [0, 0, 0, 0];

const fontSizeOf = (node: SceneNode) => (typeof node.fontSize === 'number' ? node.fontSize : 14);

/** Split text where it enters or leaves the fullwidth forms block, which may use its own fallback font. */
function segments(text: string): string[] {
  const parts = text.match(/[\uff00-\uffef]+|[^\uff00-\uffef]+/g);
  return parts ?? [''];
}
/** Ensures no wrapping where the layout says the text fits on one line. */
const WIDTH_EPSILON = 0.5;
const UNBOUNDED = 1e7;

/** One line of laid-out text: its character range and where its baseline sits in the text box. */
export interface TextLine { start: number; end: number; left: number; baseline: number }

export interface TextLayout { width: number; height: number; lines: TextLine[] }

/**
 * Lays out and draws text the way Chromium does, since that is what pen.dev shows:
 * - Skia shapes the text and breaks it into lines.
 * - Line boxes follow CSS. With `lineHeight`, every line is `fontSize * lineHeight` tall (not rounded)
 *   with the primary font centred in it. Without it, a line is as tall as the rounded ascent + descent
 *   (+ line gap, split over both) of the tallest font it uses.
 * - Each line is drawn on its own at its CSS baseline. Skia's own line spacing rounds every line to
 *   whole pixels, which drifts by several pixels over a long column.
 */
export class TextEngine implements TextMeasurer {
  private ck: CanvasKit;
  private fonts: FontStore;
  private fallbacks: FallbackFamilies;
  private cache = new Map<SceneNode, Map<number, TextLayout>>();

  constructor(ck: CanvasKit, fonts: FontStore, fallbacks: FallbackFamilies) {
    this.ck = ck;
    this.fonts = fonts;
    this.fallbacks = fallbacks;
  }

  measure(node: SceneNode, maxWidth: number | undefined): Size2 {
    const l = this.layout(node, maxWidth);
    return { width: l.width, height: l.height };
  }

  /** Lines of `node` wrapped at `maxWidth`, or unwrapped (explicit breaks only) without it. */
  layout(node: SceneNode, maxWidth: number | undefined): TextLayout {
    const key = maxWidth ?? -1;
    const hit = this.cache.get(node)?.get(key);
    if (hit) return hit;
    const text = textOf(node);
    const p = this.build(node, text);
    p.layout(maxWidth === undefined ? UNBOUNDED : maxWidth + WIDTH_EPSILON);
    let width = maxWidth ?? 0;
    if (maxWidth === undefined) {
      // Lay out again at the natural width so alignment applies within the text box.
      width = p.getMaxIntrinsicWidth();
      p.layout(width + WIDTH_EPSILON);
    }
    const metrics = p.getLineMetrics();
    p.delete();
    const lines: TextLine[] = [];
    let top = 0;
    const ranges = metrics.length ? metrics.map((m) => ({ start: m.startIndex, end: m.endExcludingWhitespaces, left: m.left })) : [{ start: 0, end: 0, left: 0 }];
    for (const r of ranges) {
      const box = this.lineBox(node, text.slice(r.start, r.end));
      lines.push({ ...r, baseline: top + box.baseline });
      top += box.height;
    }
    const out = { width, height: top, lines };
    let byWidth = this.cache.get(node);
    if (!byWidth) this.cache.set(node, (byWidth = new Map()));
    byWidth.set(key, out);
    return out;
  }

  /** Draw `node`'s text in a box of `width`, moved down by `dy`. `paint` paints gradient or image text. */
  draw(canvas: Canvas, node: SceneNode, width: number, dy: number, paint?: Paint): void {
    const growth = node.textGrowth ?? 'auto';
    const l = this.layout(node, growth === 'auto' ? undefined : width);
    const text = textOf(node);
    if (node.textAlign === 'justify' && l.lines.length > 1) {
      // Justified lines need the whole paragraph; drawn with Skia's own line spacing.
      const p = this.build(node, text, paint);
      p.layout(width + WIDTH_EPSILON);
      canvas.drawParagraph(p, 0, dy);
      p.delete();
      return;
    }
    for (const line of l.lines) {
      if (line.end <= line.start) continue;
      const p = this.build(node, text.slice(line.start, line.end), paint, true);
      p.layout(UNBOUNDED);
      const baseline = p.getLineMetrics()[0]?.baseline ?? 0;
      canvas.drawParagraph(p, line.left, dy + line.baseline - baseline);
      p.delete();
    }
  }

  /** Height and baseline of one line box holding `text`. */
  private lineBox(node: SceneNode, text: string): { height: number; baseline: number } {
    const size = fontSizeOf(node);
    const weight = fontWeight(node.fontWeight);
    const italic = isItalic(node.fontStyle);
    const primary = this.fonts.metrics(familyOf(node), weight, italic, size) ?? { ascent: Math.round(size * 0.8), descent: Math.round(size * 0.2), lineGap: 0 };
    const lh = typeof node.lineHeight === 'number' && node.lineHeight > 0 ? node.lineHeight : undefined;
    if (lh) {
      const height = size * lh;
      return { height, baseline: (height - primary.ascent - primary.descent) / 2 + primary.ascent };
    }
    let ascent = 0, descent = 0;
    const unite = (m: { ascent: number; descent: number; lineGap: number }) => {
      const half = Math.floor(m.lineGap / 2);
      ascent = Math.max(ascent, m.ascent + half);
      descent = Math.max(descent, m.descent + m.lineGap - half);
    };
    unite(primary);
    // A fallback font counts only for characters the primary font cannot draw.
    const family = familyOf(node);
    for (const [re, script] of SCRIPTS) {
      const chars = [...text].filter((c) => re.test(c)).join('');
      if (!chars || this.fonts.covers(family, weight, italic, chars)) continue;
      const fallback = this.fallbacks[script]?.find((f) => this.fonts.covers(f, weight, italic, chars) || this.fonts.has(f));
      const m = fallback && this.fonts.metrics(fallback, weight, italic, size);
      if (m) unite(m);
    }
    return { height: ascent + descent, baseline: ascent };
  }

  /** A paragraph of `text` in `node`'s style; `leftAligned` for single lines placed by the caller. */
  private build(node: SceneNode, text: string, paint?: Paint, leftAligned = false): Paragraph {
    const ck = this.ck;
    const builder = ck.ParagraphBuilder.MakeFromFontProvider(this.paragraphStyle(node, leftAligned), this.fonts.provider);
    const bg = paint ? new ck.Paint() : undefined;
    bg?.setColor(ck.TRANSPARENT);
    for (const seg of segments(text)) {
      const style = this.textStyle(node, seg);
      if (paint) builder.pushPaintStyle(style, paint, bg!);
      else builder.pushStyle(style);
      builder.addText(seg);
      builder.pop();
    }
    bg?.delete();
    const p = builder.build();
    builder.delete();
    return p;
  }

  private paragraphStyle(node: SceneNode, leftAligned: boolean): ParagraphStyle {
    const ck = this.ck;
    const align = leftAligned ? undefined : ({ center: ck.TextAlign.Center, right: ck.TextAlign.Right, justify: ck.TextAlign.Justify } as Record<string, typeof ck.TextAlign.Left>)[node.textAlign];
    return new ck.ParagraphStyle({ textAlign: align ?? ck.TextAlign.Left, textStyle: this.textStyle(node, ''), applyRoundingHack: false });
  }

  private textStyle(node: SceneNode, segment: string): TextStyle {
    const ck = this.ck;
    const color = solidTextColor(node.fill) ?? TRANSPARENT;
    const decoration = (node.underline === true ? ck.UnderlineDecoration : 0) | (node.strikethrough === true ? ck.LineThroughDecoration : 0);
    const weight = fontWeight(node.fontWeight), italic = isItalic(node.fontStyle);
    return new ck.TextStyle({
      color: ck.Color4f(...color),
      fontFamilies: [familyOf(node), ...fallbackFamilies(segment, this.fallbacks)].map((f) => this.fonts.alias(f, weight, italic) ?? f),
      fontSize: fontSizeOf(node),
      fontStyle: {
        weight: { value: weight },
        slant: italic ? ck.FontSlant.Italic : ck.FontSlant.Upright,
      },
      letterSpacing: typeof node.letterSpacing === 'number' ? node.letterSpacing : 0,
      ...(decoration ? { decoration, decorationColor: ck.Color4f(...color), decorationThickness: 1 } : {}),
    });
  }

  dispose(): void {
    this.cache.clear();
  }
}
