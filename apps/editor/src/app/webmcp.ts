import { authHeaders } from './connection.ts';
import { post } from './libraries.ts';

/**
 * WebMCP: the open document's design tools offered to AI assistants in the browser (a proposed web standard,
 * document.modelContext in Chrome; navigator.modelContext in earlier drafts and polyfills), the same calls
 * nib's MCP server offers, for this document only. Their changes show as "browser agent" in the activity.
 */

interface WebTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  execute(args: Record<string, unknown>): Promise<unknown>;
}
export interface ModelContext {
  registerTool(tool: WebTool, options?: { signal?: AbortSignal }): unknown;
}

/** The browser's model context, when it has one. */
export function modelContext(): { context: ModelContext; legacy: boolean } | undefined {
  const current = (document as unknown as { modelContext?: ModelContext }).modelContext;
  if (current) return { context: current, legacy: false };
  const legacy = (navigator as unknown as { modelContext?: ModelContext }).modelContext;
  return legacy ? { context: legacy, legacy: true } : undefined;
}

type Tool = Omit<WebTool, 'execute'> & { run(args: Record<string, unknown>): Promise<string> };

function tools(path: string): Tool[] {
  return [
    {
      name: 'get_app_state',
      description: `The nib design open in this tab (${path.split(/[\\/]/).pop()}): its top-level frames with sizes, its components, and what the person has selected. Call it first, and read_skill before your first execute.`,
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      // Not the editor's link: it carries the daemon's token, and assistants send what tools return to their servers.
      run: async () => (await post<{ text: string }>('/api/state', { filePath: path, link: false })).text,
    },
    {
      name: 'execute',
      description: 'Run a JavaScript snippet against the design open in this tab with nib\'s design API (Insert, Use, Copy, Update, Replace, Move, Delete, Get, SetVariables, FindEmptySpace, Compare, Export, Print). A snippet is one transaction: if it throws, nothing changes and the reply gives an editId to patch it with `edits`. Changes are saved and can be undone in the editor. Pictures (TakeScreenshot) are not returned here. API reference: read_skill with path "execute.md".',
      inputSchema: {
        type: 'object',
        properties: {
          input: { type: 'string', description: 'The JavaScript snippet. Omit when sending editId and edits.' },
          editId: { type: 'string', description: 'The editId a failed call printed, together with edits.' },
          edits: {
            type: 'array',
            description: 'After a failure, patch the failed snippet: each edit replaces `find` (which must occur exactly once, unless all is true) with `replace`, then the snippet runs again from the start.',
            items: { type: 'object', properties: { find: { type: 'string' }, replace: { type: 'string' }, all: { type: 'boolean' } }, required: ['find', 'replace'] },
          },
        },
      },
      annotations: { untrustedContentHint: true },
      run: async (args) => {
        const r = await post<{ ok: boolean; text: string; notes: string[]; images: unknown[] }>('/api/execute', {
          filePath: path, agent: 'browser agent',
          ...(typeof args.input === 'string' ? { input: args.input } : {}),
          ...(typeof args.editId === 'string' ? { editId: args.editId } : {}),
          ...(Array.isArray(args.edits) ? { edits: args.edits } : {}),
        });
        const notes = r.notes.map((n) => `Note: ${n}`);
        if (r.images.length) notes.push(`(${r.images.length} picture${r.images.length > 1 ? 's' : ''} not shown: WebMCP tools return text)`);
        return [r.ok ? r.text : `Failed: ${r.text}`, ...notes].join('\n\n');
      },
    },
    {
      name: 'read_skill',
      description: 'Read nib\'s guide to designing on a .pen canvas. Without a path it returns the overview, which lists the other files; pass one of those as path, e.g. "execute.md".',
      inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'A file the overview lists, e.g. "execute.md".' } } },
      annotations: { readOnlyHint: true },
      run: async (args) => {
        const r = await fetch(`/api/skill?${new URLSearchParams({ path: typeof args.path === 'string' ? args.path : '' })}`, { headers: authHeaders() });
        const j = (await r.json()) as { text?: string; error?: string };
        return j.text ?? `Failed: ${j.error ?? r.statusText}`;
      },
    },
  ];
}

/** Offer the tools for the document at `path`; the returned function takes them back. */
export function registerTools(mc: { context: ModelContext; legacy: boolean }, path: string): () => void {
  const controller = new AbortController();
  const handles: { unregister?: () => void }[] = [];
  for (const t of tools(path)) {
    const { run, ...rest } = t;
    const execute = async (args: Record<string, unknown>) => {
      let text: string;
      try { text = await run(args ?? {}); } catch (e) { text = `Failed: ${(e as Error).message}`; }
      // Earlier drafts take MCP's result shape; the current one, the text.
      return mc.legacy ? { content: [{ type: 'text', text }] } : text;
    };
    try {
      const h = mc.context.registerTool({ ...rest, execute }, { signal: controller.signal });
      if (h && typeof (h as { then?: unknown }).then === 'function') (h as Promise<unknown>).catch(() => {});
      else if (h && typeof (h as { unregister?: unknown }).unregister === 'function') handles.push(h as { unregister: () => void });
    } catch {
      // A browser that refuses a tool (one already registered by that name) keeps the others.
    }
  }
  return () => { controller.abort(); for (const h of handles) h.unregister?.(); };
}
