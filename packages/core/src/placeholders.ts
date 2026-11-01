/** `{{field}}` in a string: where a data row's value goes (see Repeat). */
export const PLACEHOLDER = /\{\{\s*([\w.$-]+)\s*\}\}/g;

/** The fields a layer's placeholders name, in order of first use (its id and nib data left out). */
export function placeholders(node: unknown): string[] {
  const out: string[] = [];
  const visit = (v: unknown) => {
    if (typeof v === 'string') { for (const m of v.matchAll(PLACEHOLDER)) if (!out.includes(m[1])) out.push(m[1]); }
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'id' && k !== 'metadata') visit(x);
  };
  visit(node);
  return out;
}
