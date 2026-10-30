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
