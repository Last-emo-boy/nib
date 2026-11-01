import { mkdir, readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scriptInputs, type ScriptInput } from '@nib/exec';
import type { DocumentHost } from './host.ts';
import { NIB_HOME } from './library.ts';

/**
 * Plugins: JavaScript files that run as one execute snippet (the same API agents use), started from the
 * command palette or `nib plugin`. A plugin names itself in comments at the top,
 *
 *   // @name Snap to grid
 *   // @description Round positions and sizes to a step.
 *   // @input step 8 1..64 Grid step
 *
 * and reads `selection` (the ids selected when it runs) and `input` (its inputs' values). Its changes are
 * one undo step, named after it. They come from nib (its own), from the person's plugins folder, and from a
 * plugins/ folder beside the design.
 */

export type PluginSource = 'nib' | 'user' | 'project';
export interface PluginInfo { id: string; name: string; description: string; inputs: ScriptInput[]; source: PluginSource; file: string }

export const NIB_PLUGINS = fileURLToPath(new URL('../plugins', import.meta.url));
export const USER_PLUGINS = join(NIB_HOME, 'plugins');

/** What a plugin says about itself in its header comments. */
export function pluginInfo(text: string, file: string, source: PluginSource): PluginInfo {
  const tag = (name: string) => new RegExp(`^[ \\t]*//\\s*@${name}\\s+(.*)$`, 'm').exec(text)?.[1].trim();
  const slug = basename(file).replace(/\.js$/, '');
  return { id: `${source}/${slug}`, name: tag('name') || slug.replace(/[-_]+/g, ' '), description: tag('description') ?? '', inputs: scriptInputs(text), source, file };
}

async function folder(dir: string, source: PluginSource): Promise<PluginInfo[]> {
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith('.js')).sort();
  return Promise.all(files.map(async (f) => pluginInfo(await readFile(join(dir, f), 'utf8'), join(dir, f), source)));
}

/** nib's plugins, the person's, and the design's (beside `doc`, when given). */
export async function listPlugins(doc?: string): Promise<PluginInfo[]> {
  return [...(await folder(NIB_PLUGINS, 'nib')), ...(await folder(USER_PLUGINS, 'user')), ...(doc ? await folder(join(dirname(doc), 'plugins'), 'project') : [])];
}

/** The person's plugins folder, made if it is not there yet. */
export async function userPluginsFolder(): Promise<string> {
  await mkdir(USER_PLUGINS, { recursive: true });
  return USER_PLUGINS;
}

/**
 * The snippet a plugin runs as: `selection` and `input` defined on its first line (in front of its first
 * comment), so the line numbers in an error are the plugin's own.
 */
export function pluginSnippet(source: string, info: Pick<PluginInfo, 'inputs'>, selection: string[], values: Record<string, unknown> = {}): string {
  const input: Record<string, unknown> = {};
  for (const i of info.inputs) {
    const v = values[i.name];
    input[i.name] = v === undefined ? i.default
      : i.kind === 'number' ? (Number.isFinite(Number(v)) ? Math.min(i.max ?? Infinity, Math.max(i.min ?? -Infinity, Number(v))) : i.default)
      : i.kind === 'boolean' ? v === true || v === 'true'
      : String(v);
  }
  return `const selection = ${JSON.stringify(selection)}, input = ${JSON.stringify(input)}; ${source}`;
}

export interface PluginRun { ok: boolean; text: string; output: string[] }

/** Run a plugin (by id, or a .js file) on `doc` as the person's change. */
export async function runPlugin(host: DocumentHost, doc: string, plugin: string, selection: string[], values: Record<string, unknown>): Promise<PluginRun> {
  let info: PluginInfo | undefined;
  if (plugin.endsWith('.js')) info = pluginInfo(await readFile(plugin, 'utf8'), plugin, 'user');
  else info = (await listPlugins(doc)).find((p) => p.id === plugin);
  if (!info) throw new Error(`no plugin "${plugin}"`);
  const source = await readFile(info.file, 'utf8');
  const r = await host.execute(doc, { input: pluginSnippet(source, info, selection, values) }, 'nib', { source: { kind: 'user' }, label: info.name });
  const printed = /## Print output\n([\s\S]*?)(?:\n## |$)/.exec(r.text)?.[1].trim();
  return { ok: r.ok, text: r.text, output: printed ? printed.split('\n') : [] };
}
