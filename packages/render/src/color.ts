/** RGBA in 0..1. */
export type RGBA = [number, number, number, number];

/** `#RGB`, `#RGBA`, `#RRGGBB` or `#RRGGBBAA`. Anything else is undefined. */
export function parseColor(v: unknown): RGBA | undefined {
  if (typeof v !== 'string' || v[0] !== '#') return undefined;
  let hex = v.slice(1);
  if (!/^[0-9a-f]+$/i.test(hex)) return undefined;
  if (hex.length === 3 || hex.length === 4) hex = [...hex].map((c) => c + c).join('');
  if (hex.length !== 6 && hex.length !== 8) return undefined;
  const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
  return [n(0), n(2), n(4), hex.length === 8 ? n(6) : 1];
}

export function withAlpha(c: RGBA, alpha: number): RGBA {
  return [c[0], c[1], c[2], c[3] * alpha];
}
