/**
 * Editor preferences, kept in this browser's storage (shared by every nib window on this computer): how far
 * arrow keys move layers, how fast the wheel zooms, the interface's look, and whether things animate.
 */
export interface Prefs {
  /** Arrow keys move layers this far; with Shift, `bigNudge`. */
  nudge: number;
  bigNudge: number;
  /** Wheel and pinch zoom speed, 1 as it comes. */
  zoomSpeed: number;
  theme: 'dark' | 'light' | 'system';
  /** Fewer animations: 'system' follows the computer's reduce-motion setting. */
  motion: 'full' | 'reduced' | 'system';
}

export const DEFAULT_PREFS: Prefs = { nudge: 1, bigNudge: 10, zoomSpeed: 1, theme: 'dark', motion: 'system' };

const KEY = 'nib-prefs';

/** Stored preferences, values out of range or of the wrong kind replaced by the defaults. */
export function readPrefs(raw: string | null = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY)): Prefs {
  let v: Record<string, unknown> = {};
  try { v = raw ? JSON.parse(raw) : {}; } catch { v = {}; }
  const num = (k: 'nudge' | 'bigNudge' | 'zoomSpeed', lo: number, hi: number) => (typeof v[k] === 'number' && v[k] >= lo && v[k] <= hi ? (v[k] as number) : DEFAULT_PREFS[k]);
  const pick = <T extends string>(k: string, allowed: readonly T[], d: T) => (allowed.includes(v[k] as T) ? (v[k] as T) : d);
  return {
    nudge: num('nudge', 0.01, 1000),
    bigNudge: num('bigNudge', 0.01, 1000),
    zoomSpeed: num('zoomSpeed', 0.1, 5),
    theme: pick('theme', ['dark', 'light', 'system'] as const, DEFAULT_PREFS.theme),
    motion: pick('motion', ['full', 'reduced', 'system'] as const, DEFAULT_PREFS.motion),
  };
}

export function writePrefs(p: Prefs): void {
  localStorage.setItem(KEY, JSON.stringify(p));
}

/** Whether the interface is light now (`system` follows the computer). */
export const isLight = (p: Prefs) => p.theme === 'light' || (p.theme === 'system' && matchMedia('(prefers-color-scheme: light)').matches);

/** Whether to keep motion to a minimum now. */
export const reducedMotion = (p: Prefs) => p.motion === 'reduced' || (p.motion === 'system' && matchMedia('(prefers-reduced-motion: reduce)').matches);

/** Show the preferences on the page: the theme and motion as attributes the styles follow. */
export function applyPrefs(p: Prefs): void {
  const root = document.documentElement;
  root.dataset.theme = isLight(p) ? 'light' : 'dark';
  root.dataset.motion = reducedMotion(p) ? 'reduced' : 'full';
}
