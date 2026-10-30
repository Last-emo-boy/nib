import { execFile } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const SERVICE = 'nib';

/**
 * API keys for providers nib calls itself: in the macOS Keychain (service "nib", account = provider id),
 * elsewhere in a file only the user can read. An environment variable, when set, wins.
 */
export class Keys {
  private file: string;

  constructor(home: string) {
    this.file = join(home, 'agent', 'keys.json');
  }

  async get(provider: string, envVar?: string): Promise<string | undefined> {
    const fromEnv = envVar ? process.env[envVar] : undefined;
    if (fromEnv) return fromEnv;
    if (process.platform === 'darwin') {
      try {
        const { stdout } = await run('security', ['find-generic-password', '-s', SERVICE, '-a', provider, '-w']);
        return stdout.trim() || undefined;
      } catch {
        return undefined;
      }
    }
    return (await this.read())[provider];
  }

  async set(provider: string, key: string | undefined): Promise<void> {
    if (process.platform === 'darwin') {
      if (key) await run('security', ['add-generic-password', '-U', '-s', SERVICE, '-a', provider, '-l', `nib: ${provider} API key`, '-w', key]);
      else await run('security', ['delete-generic-password', '-s', SERVICE, '-a', provider]).catch(() => {});
      return;
    }
    const keys = await this.read();
    if (key) keys[provider] = key; else delete keys[provider];
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(this.file, `${JSON.stringify(keys, null, 2)}\n`, { mode: 0o600 });
    await chmod(this.file, 0o600);
  }

  private async read(): Promise<Record<string, string>> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  }
}
