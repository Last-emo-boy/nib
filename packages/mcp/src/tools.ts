import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Node } from '@nib/format';
import { childrenOf } from '@nib/core';
import type { DocumentHost, OpenDocument } from './documents.ts';
import { getStyle } from './styles.ts';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult { content: Content[]; isError?: boolean }

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>, host: DocumentHost): Promise<ToolResult>;
}

export const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skill');
const LIST_LIMIT = 60;

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

export const TOOLS: Tool[] = [
  {
    name: 'get_app_state',
    description: 'Show the .pen documents nib has open: their top-level nodes with sizes, their components, and the editor selection. Pass filePath to open a document (a missing file is created). Call this first, and read_skill() before your first execute call.',
    inputSchema: {
      type: 'object',
      properties: { filePath: { type: 'string', description: 'A .pen file to open and make active.' } },
    },
    async call(args, host) {
      const notes: string[] = [];
      if (typeof args.filePath === 'string') await host.open(args.filePath, notes);
      const docs = host.list();
      for (const d of docs) await host.sync(d, notes);
      const out = ['# nib state', ''];
      if (!docs.length) {
        out.push('No document is open. Pass `filePath` (an absolute path to a .pen file) to get_app_state or execute to open one; a missing file is created.');
      }
      for (const d of docs) out.push(describe(d, d.path === host.active));
      out.push('', 'No editor is attached, so nothing is selected. Read the design guide with read_skill() before your first execute call.');
      if (notes.length) out.push('', ...notes.map((n) => `Note: ${n}`));
      return text(out.join('\n'));
    },
  },
  {
    name: 'execute',
    description: 'Run a JavaScript snippet against a .pen document with nib\'s design API (Insert, Copy, Update, Replace, Move, Delete, Get, SetVariables, FindEmptySpace, TakeScreenshot, Export, Print). A snippet is one transaction: if it throws, nothing changes and the reply gives an editId for patching it with `edits`. Successful changes are saved to the file. API reference: read_skill({path: "execute.md"}).',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute path of the .pen file. A missing file is created.' },
        input: { type: 'string', description: 'The JavaScript snippet. Omit when sending editId and edits.' },
        editId: { type: 'string', description: 'The editId a failed call printed. Send it only together with edits, never with input.' },
        edits: {
          type: 'array',
          description: 'After a failure, patch the failed snippet instead of sending it again: each edit replaces `find` (which must occur exactly once, unless all is true) with `replace`, in order, then the patched snippet runs from the start. If it fails again, keep patching the patched version under the same editId.',
          items: {
            type: 'object',
            properties: {
              find: { type: 'string' },
              replace: { type: 'string' },
              all: { type: 'boolean', description: 'Replace every occurrence.' },
            },
            required: ['find', 'replace'],
            additionalProperties: false,
          },
        },
      },
      required: ['filePath'],
    },
    async call(args, host) {
      if (typeof args.filePath !== 'string' || !args.filePath) return text('execute needs `filePath`: the absolute path of a .pen file.', true);
      const r = await host.execute(args.filePath, {
        input: typeof args.input === 'string' ? args.input : undefined,
        editId: typeof args.editId === 'string' ? args.editId : undefined,
        edits: args.edits as { find: string; replace: string; all?: boolean }[] | undefined,
      });
      const body = r.notes.length ? `${r.text}\n\n${r.notes.map((n) => `Note: ${n}`).join('\n')}` : r.text;
      return {
        content: [{ type: 'text', text: body }, ...r.images.map((i) => ({ type: 'image' as const, data: Buffer.from(i.data).toString('base64'), mimeType: i.mimeType }))],
        ...(r.ok ? {} : { isError: true }),
      };
    },
  },
  {
    name: 'read_skill',
    description: 'Read nib\'s guide to designing on a .pen canvas. Without a path it returns the overview (SKILL.md), which lists the other files; pass one of those as path, e.g. "execute.md".',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'A file listed in SKILL.md, e.g. "execute.md" or "guide/web-app.md".' } },
    },
    async call(args) {
      const path = typeof args.path === 'string' && args.path ? args.path : 'SKILL.md';
      const file = normalize(join(SKILL_DIR, path));
      if (relative(SKILL_DIR, file).startsWith('..')) return text(`"${path}" is outside the guide.`, true);
      try {
        return text(await readFile(file, 'utf8'));
      } catch {
        return text(`No guide file "${path}". Available:\n${(await skillFiles()).map((f) => `- ${f}`).join('\n')}`, true);
      }
    },
  },
  {
    name: 'get_style',
    description: 'Visual style presets (fonts, colors, spacing, imagery) to design with. Without a name it lists them; with a name it returns the preset, or the parameters it needs. Presets are guidance: they do not change the document.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'A style from the list.' },
        params: { type: 'object', description: 'Values for the parameters the style asks for.', additionalProperties: true },
      },
    },
    async call(args) {
      const r = await getStyle(typeof args.name === 'string' ? args.name : undefined, (args.params ?? {}) as Record<string, unknown>);
      return text(r.text, r.error);
    },
  },
];

function describe(d: OpenDocument, active: boolean): string {
  const doc = d.session.doc;
  const top = doc.data.children;
  const lines = [`## ${d.path}${active ? ' (active)' : ''}`, '', `Top-level nodes (${top.length}):`];
  for (const n of top.slice(0, LIST_LIMIT)) {
    const b = d.session.box(n.id);
    const size = b ? ` ${Math.round(b.width)}×${Math.round(b.height)} at (${Math.round(b.x)}, ${Math.round(b.y)})` : n.enabled === false ? ' hidden' : '';
    lines.push(`- \`${n.id}\` ${n.type}${n.name ? ` "${n.name}"` : ''}${size}${n.reusable ? ' · component' : ''}`);
  }
  if (top.length > LIST_LIMIT) lines.push(`- … ${top.length - LIST_LIMIT} more; list them with Get(n => ...)`);
  const comps: Node[] = [];
  const visit = (n: Node) => { if (n.reusable) comps.push(n); childrenOf(n)?.forEach(visit); };
  top.forEach(visit);
  lines.push('', comps.length ? `Components (${comps.length}):` : 'Components: none');
  for (const c of comps.slice(0, LIST_LIMIT)) lines.push(`- \`${c.id}\`${c.name ? ` "${c.name}"` : ''} (${c.type})`);
  if (comps.length > LIST_LIMIT) lines.push(`- … ${comps.length - LIST_LIMIT} more`);
  const vars = Object.keys(doc.data.variables ?? {});
  lines.push('', vars.length ? `Variables: ${vars.length}${doc.data.themes ? `; themes: ${Object.entries(doc.data.themes).map(([a, v]) => `${a} = ${v.join(' | ')}`).join(', ')}` : ''} (read them with GetVariables())` : 'Variables: none');
  if (doc.imports.size) lines.push(`Imports: ${[...doc.imports.keys()].map((a) => `\`${a}\``).join(', ')} (address their nodes and variables as alias:id)`);
  return lines.join('\n');
}

async function skillFiles(dir = SKILL_DIR, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await skillFiles(join(dir, e.name), `${prefix}${e.name}/`)));
    else if (e.name.endsWith('.md')) out.push(prefix + e.name);
  }
  return out.sort();
}
