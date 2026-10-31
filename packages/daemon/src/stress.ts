import { DocEditor, PenDoc, reassignIds, type Op } from '@nib/core';
import type { Node } from '@nib/format';

/**
 * Stress test: copies of a frame with what tends to break designs — long text (German runs about 1.5× as
 * long as English), Chinese and Japanese, Arabic (right to left), the dark theme, a narrow width — placed in
 * a row under the original, then reviewed, so the problems they show can be fixed in the original.
 */

export type Scenario = 'long' | 'cjk' | 'rtl' | 'dark' | 'narrow';
export const SCENARIOS: Scenario[] = ['long', 'cjk', 'rtl', 'dark', 'narrow'];

const NAMES: Record<Scenario, string> = { long: 'long text (German)', cjk: 'Chinese and Japanese', rtl: 'Arabic (right to left)', dark: 'dark theme', narrow: 'narrow width' };

const GERMAN = ['Benutzereinstellungen', 'Datenschutzerklärung', 'Zahlungsinformationen', 'Kundenzufriedenheit', 'Geschwindigkeitsbegrenzung', 'Anmeldebestätigung', 'Verfügbarkeit', 'Rechnungsadresse', 'Lieferbedingungen', 'Sicherheitsüberprüfung', 'und', 'für', 'Ihre'];
const CJK = '設定を保存しました。お支払い情報をご確認ください。会员中心与订单管理';
const ARABIC = 'حفظ الإعدادات وتأكيد معلومات الدفع لحسابك ';

type Box = { x: number; y: number; width: number; height: number };

/** Text in the scenario's script and length. */
export function stressText(text: string, scenario: Scenario): string {
  const cycle = (src: string, n: number) => Array.from({ length: n }, (_, i) => [...src][i % [...src].length]).join('');
  const length = [...text].length;
  if (scenario === 'cjk') return cycle(CJK, Math.max(2, length));
  if (scenario === 'rtl') return cycle(ARABIC, Math.max(4, Math.round(length * 1.1))).trim();
  if (scenario === 'long') {
    const words = text.split(/\s+/).filter(Boolean);
    // Text without spaces (Chinese, Japanese): about one German word for every two characters.
    const count = words.length > 1 ? words.length : Math.max(1, Math.round(length / 2));
    return Array.from({ length: count }, (_, i) => (/\d/.test(words[i] ?? '') ? words[i] : GERMAN[(i * 7 + length) % GERMAN.length])).join(' ');
  }
  return text;
}

export interface StressCopy { scenario: Scenario; label: string; id: string; name: string; map: Map<string, string> }

/** The copies of top-level frame `frameId` for `scenarios`, as ops that insert them under the original. */
export function planStress(doc: PenDoc, frameId: string, scenarios: Scenario[], box: (id: string) => Box | undefined): { ops: Op[]; copies: StressCopy[]; skipped: { scenario: Scenario; reason: string }[] } {
  const at = doc.locate(frameId);
  if (!at || at.parent) throw new Error('a stress test runs on a top-level frame');
  const b = box(frameId);
  if (!b) throw new Error('the frame has no size yet');
  // The theme value that reads as dark, on the first axis that has one.
  const dark = Object.entries(doc.data.themes ?? {}).map(([axis, values]) => [axis, values.find((v) => /dark|night|暗|深/i.test(v))] as const).find(([, v]) => v);
  const skipped: { scenario: Scenario; reason: string }[] = [];
  const run = scenarios.filter((s) => {
    if (s === 'dark' && !dark) { skipped.push({ scenario: s, reason: 'the document has no dark theme' }); return false; }
    return true;
  });
  const GAP = 160;
  const narrowWidth = b.width > 600 ? 375 : 320;
  const widthOf = (s: Scenario) => (s === 'narrow' ? Math.min(narrowWidth, b.width) : b.width);
  const row: Box = { x: b.x, y: b.y + b.height + GAP, width: run.reduce((w, s) => w + widthOf(s) + GAP, -GAP), height: b.height };
  const others = doc.data.children.map((n) => box(n.id)).filter((x): x is Box => !!x && x.width + x.height > 0);
  for (let i = 0; i <= others.length; i++) {
    const hit = others.find((o) => row.x < o.x + o.width + GAP && row.x + row.width + GAP > o.x && row.y < o.y + o.height + GAP && row.y + row.height + GAP > o.y);
    if (!hit) break;
    row.y = hit.y + hit.height + GAP;
  }
  const plan = new PenDoc(structuredClone(doc.data));
  const ed = new DocEditor(plan);
  ed.begin();
  const copies: StressCopy[] = [];
  let x = row.x;
  for (const scenario of run) {
    const copy = structuredClone(at.node) as Node & Record<string, unknown>;
    const map = reassignIds(plan, copy);
    const label = NAMES[scenario];
    copy.name = `${String(at.node.name ?? frameId)} · Stress: ${label}`;
    copy.x = Math.round(x);
    copy.y = Math.round(row.y);
    if (scenario === 'narrow') copy.width = widthOf(scenario);
    if (scenario === 'dark' && dark) copy.theme = { ...((copy.theme as Record<string, string>) ?? {}), [dark[0]]: dark[1]! };
    if (scenario === 'long' || scenario === 'cjk' || scenario === 'rtl') {
      const visit = (n: Record<string, unknown>) => {
        if (n.type === 'text' && typeof n.content === 'string' && n.content.trim()) n.content = stressText(n.content, scenario);
        for (const c of (n.children as Record<string, unknown>[] | undefined) ?? []) visit(c);
      };
      visit(copy);
    }
    ed.insert(null, copy);
    copies.push({ scenario, label, id: copy.id, name: copy.name, map });
    x += widthOf(scenario) + GAP;
  }
  return { ops: ed.pending(), copies, skipped };
}
