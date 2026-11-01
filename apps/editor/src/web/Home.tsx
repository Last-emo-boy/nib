import { useEffect, useState } from 'react';
import { openDocument } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { ago } from '../ui/Dashboard.tsx';
import { Icon } from '../ui/Icon.tsx';
import { createWebDoc, openPenFile } from './files.ts';
import { site, webDocPath } from './mode.ts';
import { deleteDoc, listDocs, putDoc, type WebDoc } from './storage.ts';

/** nib's website without a document open: the designs kept in this browser, a new one, or one from disk. */
export function WebHome() {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const [docs, setDocs] = useState<WebDoc[] | undefined>();
  const refresh = () => void listDocs().then(setDocs, () => setDocs([]));
  useEffect(refresh, []);
  const fresh = async () => openDocument(await createWebDoc(t.untitledDesign));
  const fromDisk = async () => {
    try {
      const path = await openPenFile();
      if (path) openDocument(path);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="dashboard web-home">
      <main className="dash-main">
        <header className="web-home-head">
          <span className="logo">nib</span>
          <span className="dim">{t.webTagline}</span>
          <span className="web-home-spacer" />
          <button className="dash-button" title={t.language} onClick={() => { const next = lang === 'en' ? 'zh' : 'en'; localStorage.setItem('nib-lang', next); store.set({ lang: next }); }}><Icon name="languages" size={15} /></button>
          <a className="dash-button" href={site.app} target="_blank" rel="noreferrer">{t.getTheApp}</a>
        </header>
        <div className="web-home-actions">
          <button className="dash-button primary" onClick={() => void fresh()}><Icon name="plus" size={15} />{t.newFile}</button>
          <button className="dash-button" onClick={() => void fromDisk()}><Icon name="folder" size={15} />{t.openPenFile}</button>
        </div>
        <h2 className="web-home-title">{t.inThisBrowser}</h2>
        {!docs ? <p className="dim">{t.loading}</p> : !docs.length ? <p className="dim">{t.noWebDocs}</p> : (
          <div className="dash-grid">
            {docs.map((d) => <DocCard key={d.id} d={d} refresh={refresh} lang={lang} />)}
          </div>
        )}
        <p className="dim web-home-note">{t.webNote}</p>
      </main>
    </div>
  );
}

function DocCard({ d, refresh, lang }: { d: WebDoc; refresh: () => void; lang: string }) {
  const t = useT();
  const [renaming, setRenaming] = useState(false);
  const rename = async (name: string) => {
    setRenaming(false);
    if (!name.trim() || name.trim() === d.name) return;
    await putDoc({ ...d, name: name.trim() });
    refresh();
  };
  const remove = async () => {
    if (!confirm(t.deleteWebDocConfirm.replace('{name}', d.name))) return;
    await deleteDoc(d.id);
    refresh();
  };
  return (
    <div className="dash-card" role="button" tabIndex={0} onClick={() => { if (!renaming) openDocument(webDocPath(d.id, d.name)); }}>
      <div className="dash-thumb web-thumb"><Icon name="file" size={28} /></div>
      <div className="dash-card-text">
        {renaming
          ? <input className="dash-rename" autoFocus defaultValue={d.name} onClick={(e) => e.stopPropagation()} onFocus={(e) => e.target.select()}
              onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void rename((e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(false); }}
              onBlur={(e) => void rename(e.target.value)} />
          : <span className="dash-card-title" onDoubleClick={(e) => { e.stopPropagation(); setRenaming(true); }}><Icon name="file" size={13} />{d.name}</span>}
        <span className="dash-card-sub">{d.handle ? `${d.handle.name} · ` : ''}{t.edited} {ago(d.updated, lang)}</span>
        <span className="web-card-actions">
          <button className="link-button" onClick={(e) => { e.stopPropagation(); setRenaming(true); }}>{t.rename}</button>
          <button className="link-button danger" onClick={(e) => { e.stopPropagation(); void remove(); }}>{t.delete}</button>
        </span>
      </div>
    </div>
  );
}
