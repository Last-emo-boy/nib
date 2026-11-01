import { useState } from 'react';
import { authHeaders } from '../app/connection.ts';
import { desktop } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { post } from '../app/libraries.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { ColorField, Num } from './Properties.tsx';

/** A plugin as the daemon lists it (packages/daemon/src/plugins.ts). */
export interface Plugin {
  id: string;
  name: string;
  description: string;
  source: 'nib' | 'user' | 'project';
  inputs: { name: string; kind: 'number' | 'color' | 'boolean' | 'text'; default: number | boolean | string; min?: number; max?: number; label: string }[];
}

export async function listPlugins(doc: string): Promise<{ plugins: Plugin[]; folder: string }> {
  const r = await fetch(`/api/plugins?${new URLSearchParams({ doc })}`, { headers: authHeaders() });
  return r.ok ? r.json() : { plugins: [], folder: '' };
}

/** Run a plugin on the selection; what it printed (or its error) comes back as a notice. */
export async function runPlugin(p: Plugin, inputs: Record<string, unknown> = {}): Promise<void> {
  const { conn, selection } = store.get();
  if (!conn) return;
  try {
    const r = await post<{ ok: boolean; text: string; output: string[] }>('/api/plugins/run', { doc: conn.path, id: p.id, selection, inputs });
    if (r.ok) toast(r.output.slice(0, 3).join(' ') || `${p.name}: ${store.get().lang === 'zh' ? '完成' : 'done'}`);
    else toast(`${p.name}: ${r.text.split('\n').find((l) => /error|Error/.test(l)) ?? r.text.split('\n')[0]}`);
  } catch (e) {
    toast(`${p.name}: ${(e as Error).message}`);
  }
}

/** Start a plugin: at once when it asks for nothing, else after its inputs are filled in. */
export function startPlugin(p: Plugin): void {
  if (p.inputs.length) store.set({ pluginAsking: p });
  else void runPlugin(p);
}

/** The person's plugins folder, shown in Finder (made first if missing). */
export async function openPluginsFolder(): Promise<void> {
  const { folder } = await post<{ folder: string }>('/api/plugins/folder', {});
  if (desktop) desktop.revealInFolder(folder);
  else toast(folder);
}

/** A plugin's inputs, before it runs. */
export function PluginDialog() {
  const t = useT();
  const p = useEditor((s) => s.pluginAsking) as Plugin | undefined;
  const [values, setValues] = useState<Record<string, unknown>>({});
  if (!p) return null;
  const close = () => { store.set({ pluginAsking: undefined }); setValues({}); };
  const run = () => { const v = values; close(); void runPlugin(p, v); };
  const put = (name: string, v: unknown) => setValues((x) => ({ ...x, [name]: v }));
  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <form className="palette plugin-dialog" onPointerDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); run(); }}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape') close(); }}>
        <div className="plugin-head"><strong>{p.name}</strong>{p.description && <span className="dim">{p.description}</span>}</div>
        {p.inputs.map((i) => {
          const v = values[i.name] ?? i.default;
          return (
            <label key={i.name} className="row shader-input">
              <span className="shader-label" title={i.name}>{i.label}</span>
              {i.kind === 'color' ? <ColorField value={String(v)} onChange={(c) => put(i.name, c)} />
                : i.kind === 'boolean' ? <input type="checkbox" checked={v === true} onChange={(e) => put(i.name, e.target.checked)} />
                : i.kind === 'number' ? <Num label="" value={Number(v)} onChange={(x) => put(i.name, Math.min(i.max ?? Infinity, Math.max(i.min ?? -Infinity, x)))} />
                : <input className="shader-url" autoFocus value={String(v)} onChange={(e) => put(i.name, e.target.value)} />}
            </label>
          );
        })}
        <div className="plugin-actions">
          <span className="dim">{p.source === 'project' ? t.pluginFromFolder : p.source === 'user' ? t.pluginYours : t.pluginNib}</span>
          <button type="button" className="dash-button" onClick={close}>{t.cancel}</button>
          <button type="submit" className="dash-button primary" autoFocus={!p.inputs.some((i) => i.kind === 'text')}>{t.runPlugin}</button>
        </div>
      </form>
    </div>
  );
}
