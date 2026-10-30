import { useEffect, useMemo, useRef, useState } from 'react';
import { commit } from '../app/actions.ts';
import { authHeaders, token } from '../app/connection.ts';
import { desktop, openDocument } from '../app/desktop.ts';
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

/** .lib.pen files beside this one, in its libraries/ folder, or opened recently, that it does not use yet. */
function Nearby({ path, imported, onAdd }: { path: string; imported: string[]; onAdd: (file: string) => void }) {
  const t = useT();
  const [files, setFiles] = useState<{ path: string; name: string; rel: string }[]>([]);
  useEffect(() => {
    void fetch(`/api/library/nearby?${new URLSearchParams({ doc: path })}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setFiles(j.files ?? []), () => {});
  }, [path, imported.join('|')]);
  const used = new Set(imported.map((r) => r.replace(/^\.\//, '')));
  const shown = files.filter((f) => !used.has(f.rel.replace(/^\.\//, '')));
  if (!shown.length) return null;
  return (
    <>
      <div className="comp-section static">{t.nearbyLibraries}</div>
      {shown.map((f) => (
        <div key={f.path} className="lib-row" title={f.path}>
          <span className="layer-icon component"><Icon name="library" size={15} /></span>
          <div className="lib-text"><span className="lib-name">{f.name}</span><span className="lib-sub">{f.rel}</span></div>
          <button className="lib-use" onClick={() => onAdd(f.path)}>{t.addLibrary}</button>
        </div>
      ))}
    </>
  );
}

interface BrandReading { primary: string; font?: string; radius?: number; swatches: string[]; title?: string }

/** A design system from a brand: read a website or a logo, adjust, and make a themed copy of a bundled library. */
function BrandMaker({ path }: { path: string }) {
  const t = useT();
  const catalog = useLibraries().filter((l) => l.brand);
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState<'read' | 'make' | undefined>();
  const [brand, setBrand] = useState<BrandReading | undefined>();
  const [base, setBase] = useState('shadcn');
  const [name, setName] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const read = async (body: Record<string, unknown>, fallbackName: string) => {
    setBusy('read');
    try {
      const b = await post<BrandReading>('/api/brand/read', body);
      setBrand(b);
      setName((b.title?.split(/[|·–—:-]/)[0].trim() || fallbackName).slice(0, 40));
    } catch (e) { toast((e as Error).message); } finally { setBusy(undefined); }
  };
  const readLogo = async (f: File) => {
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    await read({ image: btoa(bin), name: f.name }, f.name.replace(/\.[^.]+$/, ''));
  };
  const make = async () => {
    if (!brand) return;
    setBusy('make');
    try {
      const { font, radius, primary } = brand;
      await post('/api/library/brand', { path, base, name: name || 'Brand', brand: { primary, ...(font ? { font } : {}), ...(radius !== undefined ? { radius } : {}) } });
      toast(t.brandCreated(name || 'Brand'));
      setBrand(undefined);
      setOpen(false);
    } catch (e) { toast((e as Error).message); } finally { setBusy(undefined); }
  };
  if (!open) return <button className="lib-import" onClick={() => setOpen(true)}><Icon name="palette" size={14} />{t.brandTitle}</button>;
  const domain = () => { try { return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, '').split('.')[0]; } catch { return 'brand'; } };
  return (
    <div className="brand-maker" onKeyDown={(e) => e.stopPropagation()}>
      <div className="lib-card-head"><span className="lib-name">{t.brandTitle}</span><button className="lib-action" onClick={() => setOpen(false)}><Icon name="x" size={13} /></button></div>
      <p className="lib-summary">{t.brandHint}</p>
      <div className="brand-row">
        <input value={url} placeholder={t.brandUrl} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && url.trim() && void read({ url }, domain())} />
        <button className="lib-use" disabled={!url.trim() || !!busy} onClick={() => void read({ url }, domain())}>{busy === 'read' ? t.brandReading : t.brandRead}</button>
        <button className="lib-use secondary" disabled={!!busy} onClick={() => file.current?.click()}>{t.brandLogo}</button>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,.svg" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void readLogo(f); }} />
      </div>
      {brand && (
        <>
          <label className="brand-field"><span>{t.brandColor}</span>
            <div className="brand-swatches">
              {[...new Set([brand.primary, ...brand.swatches])].slice(0, 8).map((c) => (
                <button key={c} className={`brand-swatch${c === brand.primary ? ' on' : ''}`} style={{ background: c }} title={c} onClick={() => setBrand({ ...brand, primary: c })} />
              ))}
              <input type="color" value={brand.primary.slice(0, 7).toLowerCase()} onChange={(e) => setBrand({ ...brand, primary: e.target.value.toUpperCase() })} />
            </div>
          </label>
          <label className="brand-field"><span>{t.brandFont}</span><input value={brand.font ?? ''} placeholder={t.brandFontKeep} onChange={(e) => setBrand({ ...brand, font: e.target.value || undefined })} /></label>
          <label className="brand-field"><span>{t.brandRadius}</span><input type="number" min={0} max={32} value={brand.radius ?? ''} placeholder={t.brandFontKeep} onChange={(e) => setBrand({ ...brand, radius: e.target.value === '' ? undefined : Number(e.target.value) })} /></label>
          <label className="brand-field"><span>{t.brandBase}</span>
            <select value={base} onChange={(e) => setBase(e.target.value)}>{catalog.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
          </label>
          <label className="brand-field"><span>{t.brandName}</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <button className="lib-use brand-make" style={{ background: brand.primary, color: brandText(brand.primary), borderRadius: Math.min(12, brand.radius ?? 7) }} disabled={!!busy} onClick={() => void make()}>{t.brandCreate}</button>
        </>
      )}
    </div>
  );
}

/** White or near-black, whichever reads on `hex`. */
function brandText(hex: string): string {
  const lin = (x: number) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16) / 255));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05) >= 3 ? '#fff' : '#0a0a0a';
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
      <BrandMaker path={conn.path} />
      <Nearby path={conn.path} imported={imports.map(([, rel]) => rel)} onAdd={(file) => void run('file', () => post('/api/library/import', { path: conn.path, file }))} />
      <button className="lib-import" disabled={busy === 'file'} onClick={() => void importFile()}><Icon name="folder" size={14} />{t.importLibrary}</button>
      {!conn.path.endsWith('.lib.pen') && (
        <button className="lib-import" onClick={() => {
          if (!confirm(t.convertConfirm)) return;
          void post<{ path: string }>('/api/library/convert', { path: conn.path }).then((r) => openDocument(r.path), (e: Error) => toast(e.message));
        }}><Icon name="library" size={14} />{t.convertToLibrary}</button>
      )}
    </div>
  );
}
