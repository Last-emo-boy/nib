import { execFile } from 'node:child_process';
import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** How a client should start nib-mcp: this app's executable running as Node. */
export interface ServerCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface ClientStatus {
  id: string;
  name: string;
  found: boolean;
  configured: boolean;
  where: string;
  error?: string;
}

interface Client {
  id: string;
  name: string;
  status(cmd: ServerCommand): Promise<Omit<ClientStatus, 'id' | 'name'>>;
  configure(cmd: ServerCommand): Promise<void>;
}

const home = homedir();
const exists = (p: string) => stat(p).then(() => true, () => false);

/** A command found through the user's login shell: GUI apps start with a minimal PATH. */
async function which(cmd: string): Promise<string | undefined> {
  const shell = process.env.SHELL || '/bin/zsh';
  try {
    const { stdout } = await run(shell, ['-lc', `command -v ${cmd}`], { timeout: 8000 });
    return stdout.trim().split('\n').pop() || undefined;
  } catch {
    return undefined;
  }
}

/** Edit a JSON config: keep everything else, back up the original once, refuse files that do not parse. */
async function editJson(file: string, edit: (config: Record<string, any>) => void): Promise<void> {
  let config: Record<string, any> = {};
  const text = await readFile(file, 'utf8').catch(() => undefined);
  if (text !== undefined && text.trim()) {
    try {
      config = JSON.parse(text);
    } catch {
      throw new Error(`${file} is not plain JSON (comments?); add nib there by hand`);
    }
    if (!(await exists(`${file}.nib-backup`))) await copyFile(file, `${file}.nib-backup`);
  }
  edit(config);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
}

async function readJson(file: string): Promise<Record<string, any> | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return undefined;
  }
}

/** Clients that keep servers under `mcpServers` in a JSON file. */
function jsonClient(id: string, name: string, file: string, dir: string, extra: Record<string, unknown> = {}): Client {
  return {
    id, name,
    async status() {
      const config = await readJson(file);
      return { found: await exists(dir), configured: !!config?.mcpServers?.nib, where: file };
    },
    async configure(cmd) {
      await editJson(file, (c) => { c.mcpServers = { ...(c.mcpServers ?? {}), nib: { command: cmd.command, args: cmd.args, env: cmd.env, ...extra } }; });
    },
  };
}

const appSupport = process.platform === 'darwin' ? join(home, 'Library', 'Application Support') : process.platform === 'win32' ? process.env.APPDATA ?? join(home, 'AppData', 'Roaming') : join(home, '.config');

export const CLIENTS: Client[] = [
  {
    id: 'claude-code', name: 'Claude Code',
    async status() {
      const claude = await which('claude');
      if (!claude) return { found: false, configured: false, where: 'claude mcp add' };
      const configured = await run(claude, ['mcp', 'get', 'nib'], { timeout: 20000 }).then(() => true, () => false);
      return { found: true, configured, where: 'claude mcp add nib -s user' };
    },
    async configure(cmd) {
      const claude = await which('claude');
      if (!claude) throw new Error('the claude command was not found');
      await run(claude, ['mcp', 'remove', 'nib', '-s', 'user'], { timeout: 20000 }).catch(() => undefined);
      const env = Object.entries(cmd.env).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
      await run(claude, ['mcp', 'add', 'nib', '-s', 'user', ...env, '--', cmd.command, ...cmd.args], { timeout: 20000 });
    },
  },
  jsonClient('claude-desktop', 'Claude Desktop', join(appSupport, 'Claude', 'claude_desktop_config.json'), join(appSupport, 'Claude')),
  jsonClient('cursor', 'Cursor', join(home, '.cursor', 'mcp.json'), join(home, '.cursor')),
  jsonClient('gemini', 'Gemini CLI', join(home, '.gemini', 'settings.json'), join(home, '.gemini')),
  jsonClient('kiro', 'Kiro', join(home, '.kiro', 'settings', 'mcp.json'), join(home, '.kiro'), { disabled: false }),
  {
    id: 'opencode', name: 'OpenCode',
    async status() {
      const file = join(home, '.config', 'opencode', 'opencode.json');
      const config = await readJson(file);
      return { found: await exists(join(home, '.config', 'opencode')) || !!(await which('opencode')), configured: !!config?.mcp?.nib, where: file };
    },
    async configure(cmd) {
      await editJson(join(home, '.config', 'opencode', 'opencode.json'), (c) => {
        c.$schema ??= 'https://opencode.ai/config.json';
        c.mcp = { ...(c.mcp ?? {}), nib: { type: 'local', command: [cmd.command, ...cmd.args], environment: cmd.env, enabled: true } };
      });
    },
  },
  {
    id: 'codex', name: 'Codex CLI',
    async status() {
      const file = join(home, '.codex', 'config.toml');
      const text = await readFile(file, 'utf8').catch(() => '');
      return { found: await exists(join(home, '.codex')) || !!(await which('codex')), configured: /^\[mcp_servers\.nib\]/m.test(text), where: file };
    },
    async configure(cmd) {
      const file = join(home, '.codex', 'config.toml');
      const text = await readFile(file, 'utf8').catch(() => '');
      if (text && !(await exists(`${file}.nib-backup`))) await copyFile(file, `${file}.nib-backup`);
      const section = [
        '[mcp_servers.nib]',
        `command = ${JSON.stringify(cmd.command)}`,
        `args = [${cmd.args.map((a) => JSON.stringify(a)).join(', ')}]`,
        `env = { ${Object.entries(cmd.env).map(([k, v]) => `${k} = ${JSON.stringify(v)}`).join(', ')} }`,
      ].join('\n');
      // Replace an existing [mcp_servers.nib] table (up to the next table header), or append one.
      const re = /^\[mcp_servers\.nib\][\s\S]*?(?=^\[|(?![\s\S]))/m;
      const next = re.test(text) ? text.replace(re, `${section}\n\n`) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${section}\n`;
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, next);
    },
  },
];

export async function statuses(cmd: ServerCommand): Promise<ClientStatus[]> {
  return Promise.all(CLIENTS.map(async (c) => {
    try {
      return { id: c.id, name: c.name, ...(await c.status(cmd)) };
    } catch (e) {
      return { id: c.id, name: c.name, found: false, configured: false, where: '', error: (e as Error).message };
    }
  }));
}

export async function configure(id: string, cmd: ServerCommand): Promise<ClientStatus> {
  const client = CLIENTS.find((c) => c.id === id);
  if (!client) throw new Error(`unknown client ${id}`);
  try {
    await client.configure(cmd);
    return { id, name: client.name, ...(await client.status(cmd)) };
  } catch (e) {
    return { id, name: client.name, found: true, configured: false, where: '', error: (e as Error).message };
  }
}
