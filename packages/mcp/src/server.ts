import { createInterface } from 'node:readline';
import type { DocumentHost } from './documents.ts';
import { TOOLS } from './tools.ts';

const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
export const SERVER_VERSION = '0.1.0';

const INSTRUCTIONS = `nib edits .pen design files (the format pen.dev uses) with no usage limits. Workflow: get_app_state to see the open documents, read_skill() for the design guide (once per session), then execute with small snippets, checking your work with TakeScreenshot. Files are read from and saved to disk directly.`;

interface Request { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

/** MCP over newline-delimited JSON-RPC on stdin/stdout. Logs go to stderr. */
export function serve(host: DocumentHost, input: NodeJS.ReadableStream = process.stdin, output: NodeJS.WritableStream = process.stdout): Promise<void> {
  const send = (msg: Reply) => output.write(`${JSON.stringify(msg)}\n`);
  const rl = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set<Promise<void>>();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg: Request;
    try {
      msg = JSON.parse(line);
    } catch {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
      return;
    }
    const p = handle(host, msg).then((reply) => { if (reply) send(reply); });
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  return new Promise((resolve) => rl.on('close', () => { Promise.all(pending).then(() => resolve()); }));
}

export async function handle(host: DocumentHost, msg: Request): Promise<Reply | undefined> {
  const id = msg.id;
  const isNotification = id === undefined;
  const ok = (result: unknown): Reply | undefined => (isNotification ? undefined : { jsonrpc: '2.0', id: id ?? null, result });
  const fail = (code: number, message: string): Reply | undefined => (isNotification ? undefined : { jsonrpc: '2.0', id: id ?? null, error: { code, message } });
  try {
    switch (msg.method) {
      case 'initialize': {
        const requested = String(msg.params?.protocolVersion ?? '');
        return ok({
          protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'nib', version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
      case 'tools/call': {
        const name = String(msg.params?.name ?? '');
        const tool = TOOLS.find((t) => t.name === name);
        if (!tool) return fail(-32602, `unknown tool "${name}"`);
        try {
          return ok(await tool.call((msg.params?.arguments ?? {}) as Record<string, unknown>, host));
        } catch (e) {
          process.stderr.write(`nib: ${name} failed: ${(e as Error).stack ?? e}\n`);
          return ok({ content: [{ type: 'text', text: `${name} failed: ${(e as Error).message}` }], isError: true });
        }
      }
      case 'resources/list':
        return ok({ resources: [] });
      case 'prompts/list':
        return ok({ prompts: [] });
      default:
        if (msg.method?.startsWith('notifications/')) return undefined;
        return fail(-32601, `method not found: ${msg.method}`);
    }
  } catch (e) {
    return fail(-32603, (e as Error).message);
  }
}
