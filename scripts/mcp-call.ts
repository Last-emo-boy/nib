// Call nib-mcp tools from the command line, the way an MCP client does.
// node scripts/mcp-call.ts <outDir> <tool> [argsJson | @file.js] ...
// Several tool/args pairs run in one server process, so globals carry over. With @file.js the file's
// text is sent as execute's `input` and the file's first line comment `// filePath` names the document.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const [outDir, ...rest] = process.argv.slice(2);
if (!outDir || !rest.length) {
  console.error('usage: node scripts/mcp-call.ts <outDir> <tool> [argsJson | @snippet.js] ...');
  process.exit(2);
}
await mkdir(outDir, { recursive: true });

const main = fileURLToPath(new URL('../packages/mcp/src/main.ts', import.meta.url));
const proc = spawn(process.execPath, [main], { stdio: ['pipe', 'pipe', 'inherit'] });
const waiting = new Map<number, (msg: any) => void>();
createInterface({ input: proc.stdout }).on('line', (line) => {
  const msg = JSON.parse(line);
  waiting.get(msg.id)?.(msg);
});
let next = 1;
const request = (method: string, params: unknown) => new Promise<any>((resolve) => {
  const id = next++;
  waiting.set(id, resolve);
  proc.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
});

await request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-call', version: '0' } });
let shot = 0;
for (let i = 0; i < rest.length; ) {
  const tool = rest[i++];
  let args: Record<string, unknown> = {};
  const a = rest[i];
  if (a !== undefined && (a.startsWith('{') || a.startsWith('@'))) {
    i++;
    if (a.startsWith('@')) {
      const text = await readFile(a.slice(1), 'utf8');
      const filePath = /^\/\/\s*(\S+\.pen)/.exec(text)?.[1];
      args = { filePath, input: text };
    } else args = JSON.parse(a);
  }
  const r = (await request('tools/call', { name: tool, arguments: args })).result;
  console.log(`=== ${tool}${r.isError ? ' (error)' : ''}`);
  for (const c of r.content) {
    if (c.type === 'text') console.log(c.text);
    else {
      const file = join(outDir, `shot-${String(++shot).padStart(2, '0')}.png`);
      await writeFile(file, Buffer.from(c.data, 'base64'));
      console.log(`[image ${file}]`);
    }
  }
}
proc.stdin.end();
