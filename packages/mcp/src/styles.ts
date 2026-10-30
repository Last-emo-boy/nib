import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STYLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'styles');

interface Style {
  name: string;
  platform: string;
  tags: string[];
  summary: string;
  file: string;
}

let catalog: Promise<Style[]> | undefined;

/** Every style file under the styles folder: markdown with `name`, `platform` and `tags` front matter. */
function styles(): Promise<Style[]> {
  return (catalog ??= (async () => {
    const out: Style[] = [];
    for (const source of await readdir(STYLE_DIR, { withFileTypes: true })) {
      if (!source.isDirectory()) continue;
      const dir = join(STYLE_DIR, source.name);
      for (const f of (await readdir(dir)).filter((f) => f.endsWith('.md') && f !== 'SOURCE.md').sort()) {
        const text = await readFile(join(dir, f), 'utf8');
        const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
        const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(front)?.[1].trim().replace(/^['"]|['"]$/g, '') ?? '';
        const summary = /## Style Summary\s+([^\n]+)/.exec(text)?.[1] ?? '';
        out.push({
          name: field('name') || f.replace(/\.md$/, ''),
          platform: field('platform') || 'any',
          tags: field('tags').replace(/^\[|\]$/g, '').split(',').map((t) => t.trim()).filter(Boolean),
          summary: summary.split(/(?<=\.)\s/)[0],
          file: join(dir, f),
        });
      }
    }
    return out;
  })());
}

export async function getStyle(name: string | undefined, _params: Record<string, unknown>): Promise<{ text: string; error: boolean }> {
  const all = await styles();
  if (!name) {
    const byPlatform = new Map<string, Style[]>();
    for (const s of all) (byPlatform.get(s.platform) ?? byPlatform.set(s.platform, []).get(s.platform)!).push(s);
    const parts = ['# Styles', '', 'Pick one that fits the brief, then call get_style({name}) for its palette, type scale, spacing and component rules.'];
    for (const [platform, list] of byPlatform) {
      parts.push('', `## ${platform}`, '', ...list.map((s) => `- \`${s.name}\` (${s.tags.slice(0, 5).join(', ')}): ${s.summary}`));
    }
    return { text: parts.join('\n'), error: false };
  }
  const style = all.find((s) => s.name === name) ?? all.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!style) return { text: `No style "${name}". Call get_style() without a name to list them.`, error: true };
  const body = (await readFile(style.file, 'utf8')).replace(/^---\n[\s\S]*?\n---\n*/, '');
  const header = [
    `# Style: ${style.name}`,
    '',
    'Apply it through the document, not by hand on every node: define its colors, radii and spacing with SetVariables (e.g. `bg`, `text-primary`, `accent`, `radius-card`) and reference them as "$name" in fills, strokes, cornerRadius, gap and padding. Use its fonts by family name. Values below are guidance; adapt them to the brief.',
    '',
  ];
  return { text: header.join('\n') + body, error: false };
}
