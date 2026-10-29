import type { PenDocument } from './types.ts';

export class PenParseError extends Error {}

/** Parse .pen text. The format is JSON; `//` and `/* *\/` comments are allowed. */
export function parsePen(text: string): PenDocument {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    try {
      data = JSON.parse(stripComments(text));
    } catch (err) {
      throw new PenParseError(`invalid .pen JSON: ${(err as Error).message}`);
    }
  }
  if (!isRecord(data) || typeof data.version !== 'string' || !Array.isArray(data.children)) {
    throw new PenParseError('not a .pen document: expected an object with "version" and "children"');
  }
  return data as PenDocument;
}

/** Same layout pen.dev writes: two-space JSON, no trailing newline. */
export function serializePen(doc: PenDocument): string {
  return JSON.stringify(doc, null, 2);
}

/** Remove comments outside of string literals. Trailing commas are not accepted. */
export function stripComments(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"') {
      const start = i++;
      while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? text.length : end + 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
