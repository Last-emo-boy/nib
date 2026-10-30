import { spawn } from 'node:child_process';
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where a running daemon says how to reach it. Readable by this user only: it holds the token. */
export const INFO_FILE = process.env.NIB_HOME ? join(process.env.NIB_HOME, 'daemon.json') : join(homedir(), '.nib', 'daemon.json');

export interface DaemonInfo {
  port: number;
  token: string;
  pid: number;
  version: string;
}

export async function writeInfo(info: DaemonInfo): Promise<void> {
  await mkdir(dirname(INFO_FILE), { recursive: true, mode: 0o700 });
  await writeFile(INFO_FILE, JSON.stringify(info), { mode: 0o600 });
  await chmod(INFO_FILE, 0o600);
}

export async function removeInfo(pid: number): Promise<void> {
  const info = await readInfo();
  if (info?.pid === pid) await rm(INFO_FILE, { force: true });
}

export async function readInfo(): Promise<DaemonInfo | undefined> {
  try {
    return JSON.parse(await readFile(INFO_FILE, 'utf8')) as DaemonInfo;
  } catch {
    return undefined;
  }
}

/** The running daemon, if it answers. */
export async function findDaemon(): Promise<DaemonInfo | undefined> {
  const info = await readInfo();
  if (!info) return undefined;
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const body = (await r.json()) as { pid?: number };
    return r.ok && body.pid === info.pid ? info : undefined;
  } catch {
    return undefined;
  }
}

const MAIN = join(dirname(fileURLToPath(import.meta.url)), 'main.ts');

/** The running daemon, started in the background first when there is none. */
export async function ensureDaemon(timeoutMs = 15_000): Promise<DaemonInfo> {
  const running = await findDaemon();
  if (running) return running;
  // Under Electron (the desktop app) the same executable runs the daemon as plain Node.
  const env = process.versions.electron ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env;
  const child = spawn(process.execPath, [MAIN], { detached: true, stdio: 'ignore', env });
  child.unref();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    const info = await findDaemon();
    if (info) return info;
  }
  throw new Error(`the nib daemon did not start within ${timeoutMs / 1000}s`);
}
