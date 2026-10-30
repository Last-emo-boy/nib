import { useMemo, useState } from 'react';
import { commit } from '../app/actions.ts';
import { token } from '../app/connection.ts';
import { desktop } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { COMPONENT_MIME, componentsOf, post, previewUrl, useLibraries, type ComponentEntry } from '../app/libraries.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { boundsOf, fitView, insertInstance } from '../canvas/Canvas.tsx';
import { Icon } from './Icon.tsx';

/** Components of this file and of the libraries it uses, to find, insert or drag onto the canvas. */
export function Components() {
  const t = useT();
  const doc = useEditor((s) => s.doc);
  const conn = useEditor((s) => s.conn);
  const version = useEditor((s) => s.version);
  const catalog = useLibraries();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const sections = useMemo(() => {
    if (!doc) return [];
    const named = (alias: string) => catalog.find((l) => l.id === alias)?.name ?? alias;
    return [
      { key: '', title: t.thisFile, entries: componentsOf(doc) },
      ...[...doc.imports].map(([alias, lib]) => ({ key: alias, title: named(alias), entries: componentsOf(lib, `${alias}:`) })),
    ];
  }, [doc, version, catalog, t]);
  if (!doc || !conn) return null;
  const q = query.trim().toLowerCase();
  const shown = sections.map((s) => ({ ...s, entries: s.entries.filter((e) => !q || e.name.toLowerCase().includes(q)) }));
  const total = shown.reduce((n, s) => n + s.entries.length, 0);
  const toggle = (key: string) => { const next = new Set(closed); next.has(key) ? next.delete(key) : next.add(key); setClosed(next); };
  return (
    <div className="components-panel">
      <div className="panel-search"><Icon name="search" size={13} /><input value={query} placeholder={t.searchComponents} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} /></div>
      {!sections.some((s) => s.entries.length) && <p className="empty">{t.noComponents}</p>}
      {q && !total && <p className="empty">{t.noMatches}</p>}
      {shown.map((s) => s.entries.length > 0 && (
        <section key={s.key}>
          <button className="comp-section" onClick={() => toggle(s.key)}>
            <Icon name={closed.has(s.key) && !q ? 'chevronRight' : 'chevronDown'} size={12} />
            <span>{s.title}</span><span className="count">{s.entries.length}</span>
          </button>
          {(!closed.has(s.key) || q) && groups(s.entries).map(([group, items]) => (
            <div key={group} className="comp-group">
              {items.length > 1 && <div className="comp-group-title">{group}</div>}
              <div className="comp-grid">
                {items.map((e) => <Tile key={e.id} entry={e} local={!s.key} src={previewUrl(conn.path, e.id, s.key ? 0 : version)} label={items.length > 1 ? e.label : e.name} />)}
              </div>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

function Tile({ entry, local, src, label }: { entry: ComponentEntry; local: boolean; src: string; label: string }) {
  const t = useT();
  const goTo = () => { store.set({ selection: [entry.id] }); const b = boundsOf([entry.id]); if (b) store.set({ view: fitView(b, 2) }); };
  return (
    <button className="comp-tile" title={`${entry.name}\n${local ? t.localComponentHint : t.insertHint}`} draggable
      onDragStart={(e) => { e.dataTransfer.setData(COMPONENT_MIME, entry.id); e.dataTransfer.effectAllowed = 'copy'; }}
      onClick={() => (local ? goTo() : void insertInstance(entry.id))} onDoubleClick={() => local && void insertInstance(entry.id)}>
      <div className="comp-thumb"><img loading="lazy" src={src} alt="" draggable={false}
        // Previews come at twice their size: show them at their real size, smaller only when they do not fit.
        onLoad={(e) => { const img = e.currentTarget; img.style.width = `${img.naturalWidth / 2}px`; }}
        onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} /></div>
      <span className="comp-label">{label}</span>
    </button>
  );
}

function groups(entries: ComponentEntry[]): [string, ComponentEntry[]][] {
  const out = new Map<string, ComponentEntry[]>();
  for (const e of entries) out.set(e.group, [...(out.get(e.group) ?? []), e]);
  return [...out];
}

/** The libraries this file imports, the design systems nib ships, and importing any .pen file as one. */
export function Libraries() {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const doc = useEditor((s) => s.doc);
  const conn = useEditor((s) => s.conn);
  useEditor((s) => s.version);
  const catalog = useLibraries();
  const [busy, setBusy] = useState<string | undefined>();
  if (!doc || !conn) return null;
  const imports = Object.entries(doc.data.imports ?? {});
  const run = async (key: string, f: () => Promise<unknown>) => {
    setBusy(key);
    try { await f(); } catch (e) { toast((e as Error).message); } finally { setBusy(undefined); }
  };
  const remove = (alias: string) => {
    const { [alias]: _, ...rest } = doc.data.imports ?? {};
    void commit(`Remove library ${alias}`, (ed) => ed.setDocument({ imports: Object.keys(rest).length ? rest : undefined }));
  };
  const importFile = async () => {
    const file = desktop ? await desktop.pickFile() : prompt(t.importHint)?.trim();
    if (file) await run('file', () => post('/api/library/import', { path: conn.path, file }));
  };
  return (
    <div className="libraries-panel">
      <div className="comp-section static">{t.inThisFile}</div>
      {!imports.length && <p className="empty">{t.noLibraries}</p>}
      {imports.map(([alias, rel]) => {
        const lib = doc.imports.get(alias);
        const info = catalog.find((l) => l.id === alias);
        return (
          <div key={alias} className="lib-row" title={rel}>
            <span className="layer-icon component"><Icon name="library" size={15} /></span>
            <div className="lib-text">
              <span className="lib-name">{info?.name ?? alias}</span>
              <span className="lib-sub">{lib ? t.componentCount(componentsOf(lib).length) : t.libraryMissing} · {rel.replace(/^\.\//, '')}</span>
            </div>
            <button className="lib-action" title={t.removeLibrary} onClick={() => remove(alias)}><Icon name="x" size={13} /></button>
          </div>
        );
      })}
      <div className="comp-section static">{t.designSystems}</div>
      {catalog.map((l) => {
        const added = (doc.data.imports ?? {})[l.id]?.endsWith(`${l.id}.lib.pen`);
        return (
          <div key={l.id} className="lib-card">
            <img className="lib-thumb" loading="lazy" src={`/api/thumbnail?${new URLSearchParams({ library: l.id, size: '480', t: token() })}`} alt="" />
            <div className="lib-card-text">
              <div className="lib-card-head">
                <span className="lib-name">{l.name}</span>
                <button className={`lib-use${added ? ' done' : ''}`} disabled={added || busy === l.id}
                  onClick={() => void run(l.id, () => post('/api/library/use', { path: conn.path, id: l.id }))}>{added ? t.libraryAdded : t.addLibrary}</button>
              </div>
              <span className="lib-summary">{l.summary[lang]}</span>
              <span className="lib-sub">{t.componentCount(l.components)} · {l.license}</span>
            </div>
          </div>
        );
      })}
      <button className="lib-import" disabled={busy === 'file'} onClick={() => void importFile()}><Icon name="folder" size={14} />{t.importLibrary}</button>
    </div>
  );
}
