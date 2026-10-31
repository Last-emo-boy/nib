import { CELL_NAMES } from '@nib/render';
import type { DesignText, PictureComparison } from '@nib/exec';

/**
 * Implementation check: a running app's page next to the design frame it was built from. Texts are matched
 * by what they say, then compared for place, size, weight, color and font; what is only in one of them is
 * listed too. Worded for a coding agent to fix the page.
 */

/** A piece of text on the page: its element's own text (with inline children), box on the page and style. */
export interface PageText { text: string; x: number; y: number; width: number; height: number; fontSize: number; fontWeight: number; color: string; fontFamily: string; selector: string }

/** Run in the page: its visible texts, at most 800. */
export const PAGE_TEXT_SCRIPT = `(() => {
  const out = [], done = new Set();
  const selector = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && e !== document.body && parts.length < 4; e = e.parentElement) {
      let s = e.tagName.toLowerCase();
      if (e.id) { parts.unshift(s + '#' + CSS.escape(e.id)); break; }
      const cls = [...e.classList].filter((c) => c.length < 30 && !/^(css|sc|jsx|svelte|astro)-/.test(c)).slice(0, 2);
      if (cls.length) s += '.' + cls.map((c) => CSS.escape(c)).join('.');
      const like = e.parentElement ? [...e.parentElement.children].filter((x) => x.matches(s)) : [];
      if (like.length > 1) s += ':nth-of-type(' + ([...e.parentElement.children].filter((x) => x.tagName === e.tagName).indexOf(e) + 1) + ')';
      parts.unshift(s);
      // Short as it can be: stop once it names one element.
      if (document.querySelectorAll(parts.join(' > ')).length === 1) break;
    }
    return parts.join(' > ');
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.nextNode(); el && out.length < 800; el = walker.nextNode()) {
    if (done.has(el) || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG)$/i.test(el.tagName)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
    if (!own.length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    // Inline children (a link, bold words) belong to the same text.
    const kids = [...el.children];
    const inline = kids.every((k) => /^inline/.test(getComputedStyle(k).display) && !k.querySelector('*:not(br)'));
    let text, nodes;
    if (kids.length && inline) { text = el.innerText; nodes = [el]; kids.forEach((k) => done.add(k)); }
    else { text = own.map((n) => n.textContent).join(' '); nodes = own; }
    text = (text || '').replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        if (r.width < 0.5 || r.height < 0.5) continue;
        x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom);
      }
    }
    if (x0 === Infinity) continue;
    out.push({ text: text.slice(0, 300), x: x0 + scrollX, y: y0 + scrollY, width: x1 - x0, height: y1 - y0, fontSize: parseFloat(cs.fontSize), fontWeight: Number(cs.fontWeight) || 400,
      color: cs.color, fontFamily: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(), selector: selector(el) });
  }
  return out;
})()`;

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[“”"'’‘.,:;!?…·•]/g, '').trim();

/** `rgb(…)`/`rgba(…)` or `#RRGGBB` as [r, g, b] 0–255. */
function rgb(c: string): [number, number, number] | undefined {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(c);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  const h = /^#([0-9a-f]{6})/i.exec(c);
  return h ? [0, 2, 4].map((i) => parseInt(h[1].slice(i, i + 2), 16)) as [number, number, number] : undefined;
}
const hex = (c: [number, number, number]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()}`;

type Box = { x: number; y: number; width: number; height: number };
const SLACK = 8;

/**
 * How far a text is out of place on the page, along each axis (0: in place). A text counts as moved only
 * when it lines up with the frame by none of its edges or its center and keeps its distance to the text
 * before it neither: so a heading set smaller, which moves everything under it, is reported once, as its
 * size, not as every block below it moving up.
 */
function moved(d: Box, p: Box, prev?: Box, pp?: Box): { dx: number; dy: number } {
  const edges = (a: number, size: number) => [a, a + size / 2, a + size];
  const aligned = (da: number, ds: number, pa: number, ps: number) => edges(da, ds).some((v, k) => Math.abs(v - edges(pa, ps)[k]) <= SLACK);
  const sameRow = (a: Box, b: Box) => Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > Math.min(a.height, b.height) / 2;
  let dx = 0, dy = 0;
  if (!aligned(d.x, d.width, p.x, p.width)) {
    // Beside the text before it: the gap between them. Under it: the shift it shares with it.
    const keeps = prev && pp && (sameRow(d, prev) ? Math.abs((p.x - pp.x - pp.width) - (d.x - prev.x - prev.width)) <= SLACK : Math.abs((p.x - d.x) - (pp.x - prev.x)) <= SLACK);
    if (!keeps) dx = Math.round(p.x - d.x);
  }
  if (!aligned(d.y, d.height, p.y, p.height)) {
    const keeps = prev && pp && (sameRow(d, prev) ? Math.abs((p.y + p.height / 2 - pp.y - pp.height / 2) - (d.y + d.height / 2 - prev.y - prev.height / 2)) <= SLACK
      : Math.abs((p.y - pp.y - pp.height) - (d.y - prev.y - prev.height)) <= SLACK);
    if (!keeps) dy = Math.round(p.y - d.y);
  }
  return { dx, dy };
}

export interface TextDifference { design: DesignText; page?: PageText; changes: string[] }

export interface TextMatch {
  /** Texts in both, with what differs (empty when nothing does). */
  matched: TextDifference[];
  missing: DesignText[];
  extra: PageText[];
}

/** Match the design's texts with the page's and say what differs. */
export function matchTexts(design: DesignText[], page: PageText[]): TextMatch {
  const free = new Set(page);
  const dist = (d: DesignText, p: PageText) => Math.hypot(p.x - d.x, p.y - d.y);
  const nearest = (d: DesignText, ok: (p: PageText) => boolean) => [...free].filter(ok).sort((a, b) => dist(d, a) - dist(d, b))[0];
  const matched: TextDifference[] = [], missing: DesignText[] = [];
  const pairs = new Map<DesignText, PageText>();
  // Same words first, then one containing the other (a label that changed a little), longest texts first.
  const order = [...design].sort((a, b) => b.text.length - a.text.length);
  for (const d of order) {
    const p = nearest(d, (p) => norm(p.text) === norm(d.text));
    if (p) { pairs.set(d, p); free.delete(p); }
  }
  for (const d of order) {
    if (pairs.has(d)) continue;
    const t = norm(d.text);
    const p = t.length >= 4 ? nearest(d, (p) => { const q = norm(p.text); return q.length >= 4 && (q.includes(t) || t.includes(q)); }) : undefined;
    if (p) { pairs.set(d, p); free.delete(p); }
  }
  // Then a sentence reworded on the page: most of its words the same.
  const words = (s: string) => new Set(norm(s).split(' ').filter(Boolean));
  for (const d of order) {
    if (pairs.has(d)) continue;
    const a = words(d.text);
    const p = a.size >= 3 ? nearest(d, (p) => { const b = words(p.text); const both = [...a].filter((w) => b.has(w)).length; return both / (a.size + b.size - both) >= 0.5; }) : undefined;
    if (p) { pairs.set(d, p); free.delete(p); } else missing.push(d);
  }
  // In reading order, so each text can be placed relative to the one before it.
  const reading = design.filter((d) => pairs.has(d)).sort((a, b) => a.y - b.y || a.x - b.x);
  for (const [i, d] of reading.entries()) {
    const p = pairs.get(d)!;
    const changes: string[] = [];
    if (norm(p.text) !== norm(d.text)) changes.push(`text "${d.text.slice(0, 80)}" → "${p.text.slice(0, 80)}"`);
    const { dx, dy } = moved(d, p, reading[i - 1], reading[i - 1] && pairs.get(reading[i - 1]));
    if (dx || dy) {
      const parts = [dx && `${Math.abs(dx)}px ${dx > 0 ? 'right' : 'left'}`, dy && `${Math.abs(dy)}px ${dy > 0 ? 'lower' : 'higher'}`].filter(Boolean);
      changes.push(`${parts.join(' and ')} than in the design`);
    }
    if (Math.abs(p.fontSize - d.fontSize) >= 1) changes.push(`font size ${d.fontSize}px → ${Math.round(p.fontSize * 10) / 10}px`);
    if (Math.abs(p.fontWeight - d.fontWeight) >= 100) changes.push(`font weight ${d.fontWeight} → ${p.fontWeight}`);
    const dc = d.color ? rgb(d.color) : undefined, pc = rgb(p.color);
    if (dc && pc && dc.reduce((s, v, i) => s + Math.abs(v - pc[i]), 0) > 30) changes.push(`color ${hex(dc)} → ${hex(pc)}`);
    if (p.fontFamily && norm(p.fontFamily) !== norm(d.fontFamily)) changes.push(`font ${d.fontFamily} → ${p.fontFamily}`);
    matched.push({ design: d, page: p, changes });
  }
  return { matched, missing, extra: [...free].sort((a, b) => a.y - b.y || a.x - b.x) };
}

/** The check as text for a coding agent: what to change on the page so it matches the design. */
export function implementationReport(o: { url: string; frame: { id: string; name: string }; pixels: PictureComparison; match: TextMatch }): string {
  const { pixels: px, match } = o;
  const pct = (v: number) => `${Math.round(v * 1000) / 10}%`;
  const worst = px.cells.map((v, i) => [v, i] as const).filter(([v]) => v > 0.05).sort((a, b) => b[0] - a[0]).slice(0, 3).map(([v, i]) => `${CELL_NAMES[i]} ${pct(v)}`);
  const lines = [
    `Implementation check of ${o.url} against the design frame "${o.frame.name}" (id ${o.frame.id}).`,
    `The design is ${px.width}×${px.height}; the page, ${px.width} wide, is ${px.pictureWidth}×${px.pictureHeight}${px.pictureWidth > px.width + 1 ? ' (wider than the window: something overflows sideways)' : ''}.`,
    `Pixels: ${pct(px.similarity)} similar, ${pct(px.changed)} differ${worst.length ? ` (most in the ${worst.join(', ')})` : ''}, comparing the top ${px.height}px of the page. The difference image shows the design in gray and what differs in red.`,
  ];
  const by = (a: { y: number; x: number }, b: { y: number; x: number }) => a.y - b.y || a.x - b.x;
  const changed = match.matched.filter((m) => m.changes.length).sort((a, b) => by(a.design, b.design));
  const label = (d: DesignText) => `"${d.text.replace(/\s+/g, ' ').slice(0, 60)}" (design \`${d.id}\`)`;
  if (changed.length) lines.push('', 'Differences (design → page):', ...changed.map((m) => `- ${label(m.design)} at \`${m.page!.selector}\`: ${m.changes.join('; ')}`));
  if (match.missing.length) lines.push('', 'In the design but not on the page:', ...[...match.missing].sort(by).map((d) => `- ${label(d)}, ${d.fontSize}px at (${Math.round(d.x)}, ${Math.round(d.y)})`));
  if (match.extra.length) lines.push('', 'On the page but not in the design:', ...match.extra.slice(0, 30).map((p) => `- "${p.text.slice(0, 60)}" at \`${p.selector}\`, (${Math.round(p.x)}, ${Math.round(p.y)})`), ...(match.extra.length > 30 ? [`- and ${match.extra.length - 30} more`] : []));
  const same = match.matched.length - changed.length;
  lines.push('', `${same} of ${match.matched.length + match.missing.length} texts in the design match the page exactly${changed.length || match.missing.length || match.extra.length ? '.' : ': the page follows the design.'}`);
  return lines.join('\n');
}
