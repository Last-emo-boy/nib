import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpHost } from './hosts.ts';
import { getStyle } from './styles.ts';

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult { content: Content[]; isError?: boolean }

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call(args: Record<string, unknown>, host: McpHost): Promise<ToolResult>;
}

export const SKILL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'skill');

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
      return text(await host.appState(typeof args.filePath === 'string' ? args.filePath : undefined));
    },
  },
  {
    name: 'execute',
    description: 'Run a JavaScript snippet against a .pen document with nib\'s design API (Insert, Use, Copy, Update, Replace, Move, Delete, Get, SetVariables, FindEmptySpace, TakeScreenshot, Compare, Export, Print). A snippet is one transaction: if it throws, nothing changes and the reply gives an editId for patching it with `edits`. Successful changes are saved to the file. API reference: read_skill({path: "execute.md"}).',
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
        content: [{ type: 'text', text: body }, ...r.images.map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType }))],
        ...(r.ok ? {} : { isError: true }),
      };
    },
  },
  {
    name: 'browser',
    description: 'Drive a web page in nib\'s browser: load a url, take screenshots, read an element\'s DOM and styles, import a page or element as editable layers (import-to-canvas), place a screenshot on the canvas, or send a Chrome DevTools Protocol command. Pass nodeId to use a browser node on the canvas (the page then takes its size and the node shows it); without it a shared page is used. Call load-page first.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'The .pen file the result goes into (import-to-canvas, screenshot-to-canvas) or whose browser node is used.' },
        action: { type: 'string', enum: ['load-page', 'import-to-canvas', 'screenshot-to-canvas', 'return-element', 'return-screenshot', 'cdp'] },
        nodeId: { type: 'string', description: 'A browser node (type "browser") in the document; omit for the shared page.' },
        target: { type: 'string', enum: ['full-page', 'selection', 'query'], description: 'What to act on (default full-page).' },
        querySelector: { type: 'string', description: 'CSS selector, for target "query".' },
        url: { type: 'string', description: 'http(s) or file URL, for load-page.' },
        method: { type: 'string', description: 'A CDP method such as "Input.dispatchMouseEvent" (domains DOM, Input, Page, Runtime, Emulation, CSS, Accessibility), for cdp.' },
        params: { type: 'object', additionalProperties: true, description: 'The CDP method\'s parameters.' },
      },
      required: ['filePath', 'action'],
    },
    async call(args, host) {
      if (typeof args.filePath !== 'string') return text('browser needs `filePath`: the .pen file to work with.', true);
      const { filePath, ...rest } = args;
      const r = await host.browser(filePath, rest as never);
      return { content: [{ type: 'text', text: r.text }, ...r.images.map((i) => ({ type: 'image' as const, data: i.data, mimeType: i.mimeType }))], ...(r.isError ? { isError: true } : {}) };
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

async function skillFiles(dir = SKILL_DIR, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...(await skillFiles(join(dir, e.name), `${prefix}${e.name}/`)));
    else if (e.name.endsWith('.md')) out.push(prefix + e.name);
  }
  return out.sort();
}
