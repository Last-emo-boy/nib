import { describe, expect, it } from 'vitest';
import type { DesignText } from '@nib/exec';
import { implementationReport, matchTexts, type PageText } from '../src/browser/implementation.ts';

const d = (id: string, text: string, x: number, y: number, extra: Partial<DesignText> = {}): DesignText => ({ id, text, x, y, width: 100, height: 20, fontSize: 16, fontWeight: 400, fontFamily: 'Inter', color: '#111111', ...extra });
const p = (text: string, x: number, y: number, extra: Partial<PageText> = {}): PageText => ({ text, x, y, width: 100, height: 20, fontSize: 16, fontWeight: 400, color: 'rgb(17, 17, 17)', fontFamily: 'Inter', selector: `#${text.split(' ')[0].toLowerCase()}`, ...extra });

describe('implementation check', () => {
  it('matches texts by what they say and lists what differs', () => {
    const design = [
      d('h1', 'Plan your week', 40, 100, { fontSize: 60, fontWeight: 700 }),
      d('cta', 'Start free', 40, 200, { color: '#FFFFFF', fontWeight: 600 }),
      d('l3', 'Customers', 600, 20),
      d('same', 'Docs', 700, 20),
      d('sub', 'Brightside turns your tasks into a plan.', 40, 160),
    ];
    const page = [
      p('Plan your week', 40, 112, { fontSize: 48, fontWeight: 700 }),
      p('Start free', 41, 201, { color: 'rgb(240, 240, 240)', fontWeight: 400, fontFamily: 'Arial' }),
      p('Docs', 702, 21),
      p('Brightside turns your tasks into one calm plan, every week.', 40, 160),
      p('Blog', 800, 20),
    ];
    const m = matchTexts(design, page);
    const of = (id: string) => m.matched.find((x) => x.design.id === id)!.changes;
    expect(of('h1')).toEqual(['12px lower than in the design', 'font size 60px → 48px']);
    expect(of('cta')).toEqual(['font weight 600 → 400', 'color #FFFFFF → #F0F0F0', 'font Inter → Arial']);
    expect(of('same')).toEqual([]);
    expect(m.missing.map((x) => x.id)).toEqual(['l3']);
    expect(m.extra.map((x) => x.text)).toEqual(['Blog']);
    // Reworded on the page, most words the same: the same text, changed.
    expect(of('sub')).toEqual(['text "Brightside turns your tasks into a plan." → "Brightside turns your tasks into one calm plan, every week."']);
  });

  it('reports what moved, not what moved along with it', () => {
    const design = [
      d('logo', 'Brightside', 0, 0), d('a', 'Product', 500, 0, { width: 60 }), d('b', 'Pricing', 580, 0, { width: 60 }),
      d('h1', 'Plan your week', 200, 100, { width: 400, height: 72, fontSize: 60 }), d('para', 'Tasks and goals in one plan', 300, 200),
    ];
    const page = [
      p('Brightside', 0, 0), p('Product', 540, 0, { width: 60 }), p('Pricing', 620, 0, { width: 60 }),
      // Set smaller: still centered, and the paragraph under it keeps its distance.
      p('Plan your week', 240, 100, { width: 320, height: 58, fontSize: 48 }), p('Tasks and goals in one plan', 300, 186),
    ];
    const m = matchTexts(design, page);
    const of = (id: string) => m.matched.find((x) => x.design.id === id)!.changes;
    expect(of('a')).toEqual(['40px right than in the design']);
    expect(of('b')).toEqual([]);
    expect(of('h1')).toEqual(['font size 60px → 48px']);
    expect(of('para')).toEqual([]);
  });

  it('pairs a label with a longer one that contains it, and says the text changed', () => {
    const m = matchTexts([d('b', 'Sign up', 10, 10)], [p('Sign up free', 10, 10)]);
    expect(m.matched[0].changes).toEqual(['text "Sign up" → "Sign up free"']);
  });

  it('writes the report for a coding agent', () => {
    const m = matchTexts([d('h1', 'Hello', 0, 0, { fontSize: 40 }), d('x', 'Gone', 0, 50)], [p('Hello', 0, 0, { fontSize: 32 }), p('New', 0, 90)]);
    const text = implementationReport({ url: 'http://localhost:3000/', frame: { id: 'f', name: 'Home' }, match: m,
      pixels: { width: 1280, height: 800, pictureWidth: 1280, pictureHeight: 1400, similarity: 0.9123, changed: 0.12, cells: [0.3, 0, 0, 0, 0.1, 0, 0, 0, 0], diff: new Uint8Array() } });
    expect(text).toContain('Implementation check of http://localhost:3000/ against the design frame "Home" (id f).');
    expect(text).toContain('Pixels: 91.2% similar, 12% differ (most in the top-left 30%, middle 10%)');
    expect(text).toContain('- "Hello" (design `h1`) at `#hello`: font size 40px → 32px');
    expect(text).toContain('In the design but not on the page:\n- "Gone" (design `x`), 16px at (0, 50)');
    expect(text).toContain('On the page but not in the design:\n- "New" at `#new`, (0, 90)');
    expect(text).toContain('0 of 2 texts in the design match the page exactly.');
  });
});
