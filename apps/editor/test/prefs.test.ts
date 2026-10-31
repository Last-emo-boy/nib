import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, readPrefs } from '../src/app/prefs.ts';

describe('editor preferences', () => {
  it('reads stored preferences, keeping defaults for anything missing, malformed or out of range', () => {
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(readPrefs('not json')).toEqual(DEFAULT_PREFS);
    expect(readPrefs(JSON.stringify({ nudge: 0.5, bigNudge: 8, zoomSpeed: 2, theme: 'light', motion: 'reduced' }))).toEqual({ nudge: 0.5, bigNudge: 8, zoomSpeed: 2, theme: 'light', motion: 'reduced' });
    expect(readPrefs(JSON.stringify({ nudge: -1, zoomSpeed: 99, theme: 'neon', motion: 3 }))).toEqual(DEFAULT_PREFS);
  });
});
