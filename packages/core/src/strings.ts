import type { Node, PenDocument, Variable } from '@nib/format';
import { childrenOf, type PenDoc } from './doc.ts';
import { parseCsvRows } from './csv.ts';

/**
 * Text in several languages, with what .pen already has: a theme axis named Language (its values are
 * language codes: en, zh, de…) and string variables with one value per language. A text layer whose content
 * is "$str.home.title" shows the value for the language in effect, so a frame's theme picks its language.
 */

export const LANGUAGE_AXIS = 'Language';

export interface StringRow { key: string; values: Record<string, string> }

export function languagesOf(doc: PenDocument): string[] {
  return doc.themes?.[LANGUAGE_AXIS] ?? [];
}

/** The value a string variable has for one language (themed entries for exactly it; else its plain value). */
function valueFor(v: Variable, lang: string): string | undefined {
  if (!Array.isArray(v.value)) return typeof v.value === 'string' ? v.value : undefined;
  const hit = v.value.find((e) => e.theme && Object.keys(e.theme).length === 1 && e.theme[LANGUAGE_AXIS] === lang);
  return typeof hit?.value === 'string' ? hit.value : undefined;
}

/** The document's translatable strings: string variables that vary by language, or are named str.*. */
export function stringsTable(doc: PenDocument): StringRow[] {
  const langs = languagesOf(doc);
  return Object.entries(doc.variables ?? {})
    .filter(([key, v]) => v.type === 'string' && (key.startsWith('str.') || (Array.isArray(v.value) && v.value.some((e) => e.theme && LANGUAGE_AXIS in e.theme))))
    .map(([key, v]) => ({ key, values: Object.fromEntries(langs.flatMap((l) => { const s = valueFor(v, l); return s === undefined ? [] : [[l, s]]; })) }));
}

/** A string variable with `values` per language (others it had stay). */
export function stringVariable(prev: Variable | undefined, values: Record<string, string>): Variable {
  const entries = (prev && Array.isArray(prev.value) ? prev.value : []).filter((e) => !(e.theme && Object.keys(e.theme).length === 1 && e.theme[LANGUAGE_AXIS] in values));
  return { type: 'string', value: [...entries, ...Object.entries(values).map(([l, value]) => ({ value, theme: { [LANGUAGE_AXIS]: l } }))] };
}

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 24) || 'text';

/**
 * Turn the literal texts under `roots` into strings: a variable each (named str.<frame>.<text>, one per
 * distinct text, reusing one that already says the same in `lang`), the text layer then showing it.
 */
export function extractStrings(doc: PenDoc, roots: string[], lang: string): { variables: Record<string, Variable>; contents: { id: string; content: string }[] } {
  const known = new Map<string, string>();
  for (const r of stringsTable(doc.data)) if (r.values[lang] !== undefined) known.set(r.values[lang], r.key);
  const taken = new Set(Object.keys(doc.data.variables ?? {}));
  const variables: Record<string, Variable> = {};
  const contents: { id: string; content: string }[] = [];
  const visit = (n: Node, frame: string) => {
    // Content naming a variable already shows it ("$48.2K" names none, so it is text like any other).
    const content = n.type === 'text' && typeof n.content === 'string' ? n.content : undefined;
    const named = !!content && content.startsWith('$') && (content.slice(1) in (doc.data.variables ?? {}) || content.includes(':'));
    if (content?.trim() && !named) {
      let key = known.get(content);
      if (!key) {
        const base = `str.${frame}.${slug(n.name && n.name !== 'text' ? n.name : content)}`;
        key = base;
        for (let i = 2; taken.has(key); i++) key = `${base}-${i}`;
        taken.add(key);
        known.set(content, key);
        variables[key] = stringVariable(doc.data.variables?.[key], { [lang]: content });
      }
      contents.push({ id: n.id, content: `$${key}` });
    }
    for (const c of childrenOf(n) ?? []) visit(c, frame);
  };
  for (const id of roots) {
    const n = doc.get(id);
    if (n) visit(n, slug(String(doc.topLevel(id)?.name ?? 'screen')));
  }
  return { variables, contents };
}

const csvField = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** The strings as CSV: key, then a column per language. */
export function stringsToCsv(doc: PenDocument): string {
  const langs = languagesOf(doc);
  return [['key', ...langs], ...stringsTable(doc).map((r) => [r.key, ...langs.map((l) => r.values[l] ?? '')])].map((row) => row.map(csvField).join(',')).join('\n') + '\n';
}

/** CSV with a key column and a column per language, as variables to set (empty cells are left as they are). */
export function stringsFromCsv(doc: PenDocument, csv: string): Record<string, Variable> {
  const [head, ...rows] = parseCsvRows(csv);
  if (!head || head[0]?.trim().toLowerCase() !== 'key') throw new Error('the first column is "key", then a column per language (en, zh…)');
  const langs = head.slice(1).map((h) => h.trim()).filter(Boolean);
  const out: Record<string, Variable> = {};
  for (const r of rows) {
    const key = r[0]?.trim();
    if (!key) continue;
    const values = Object.fromEntries(langs.flatMap((l, i) => (r[i + 1] ? [[l, r[i + 1]]] : [])));
    out[key] = stringVariable(doc.variables?.[key], values);
  }
  return out;
}
