import { execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

/**
 * Where a command-line tool is installed: on PATH, or where its installers put it (an app started from
 * the Finder gets a short PATH).
 */
export async function findExecutable(name: string): Promise<string | undefined> {
  const home = homedir();
  const dirs = [
    ...(process.env.PATH ?? '').split(delimiter).filter(Boolean),
    '/opt/homebrew/bin', '/usr/local/bin', join(home, '.local', 'bin'), join(home, '.claude', 'local'), join(home, '.npm-global', 'bin'), join(home, '.bun', 'bin'),
  ];
  for (const dir of dirs) {
    const file = join(dir, process.platform === 'win32' ? `${name}.exe` : name);
    try {
      await access(file, constants.X_OK);
      return file;
    } catch {
      // Not here.
    }
  }
  return undefined;
}

/** The text of a tool result's content: a string, or text blocks among others (images are counted). */
export function textOf(content: unknown, limit = 4000): string {
  if (typeof content === 'string') return content.slice(0, limit);
  if (!Array.isArray(content)) return '';
  const parts: string[] = [];
  let images = 0;
  for (const b of content as { type?: string; text?: string }[]) {
    if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b?.type === 'image') images++;
  }
  if (images) parts.push(`[${images} image${images > 1 ? 's' : ''}]`);
  return parts.join('\n').slice(0, limit);
}

const checked = new Map<string, { at: number; ok: boolean }>();

/**
 * Whether a command-line tool reports a sign-in: `args` (its status command) must succeed and its output
 * pass `ok`. Answers are kept for half a minute, since the provider list asks often.
 */
export function signedIn(bin: string, args: string[], env: Record<string, string | undefined>, ok: (out: string) => boolean): Promise<boolean> {
  const key = `${bin} ${args.join(' ')}`;
  const hit = checked.get(key);
  if (hit && Date.now() - hit.at < 30_000) return Promise.resolve(hit.ok);
  return new Promise((resolve) => {
    execFile(bin, args, { env: env as NodeJS.ProcessEnv, timeout: 10_000 }, (err, stdout, stderr) => {
      const result = !err && ok(`${stdout}${stderr}`);
      checked.set(key, { at: Date.now(), ok: result });
      resolve(result);
    });
  });
}

/** Forget sign-in answers (after the person signs in). */
export const forgetSignIns = () => checked.clear();
