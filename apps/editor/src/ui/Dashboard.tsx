import { useEffect, useMemo, useState } from 'react';
import { authHeaders, token } from '../app/connection.ts';
import { desktop, openDocument } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';

interface FileEntry { path: string; name: string; folder: string; modified: number; opened?: number; draft: boolean }
interface Template { id: string; scene: string; frames: number; width: number; height: number; title: { en: string; zh: string }; summary: { en: string; zh: string }; tags: string[] }

type View = 'recents' | 'drafts' | `templates:${string}`;

const SCENES: [string, IconName][] = [['all', 'grid'], ['card', 'square'], ['slides', 'frame'], ['infographic', 'text'], ['comparison', 'copy'], ['tutorial', 'note'], ['carousel', 'layers'], ['app', 'box'], ['web', 'link']];
const KINDS: [string, IconName][] = [['landing', 'frame'], ['mobile', 'box'], ['webapp', 'panelLeft'], ['slides', 'frame'], ['dashboard', 'grid'], ['other', 'sparkles']];

const thumbUrl = (q: Record<string, string>) => `/api/thumbnail?${new URLSearchParams({ ...q, t: token() })}`;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? { headers: authHeaders() } : { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}

/** The start page: a prompt for a new design, recent files, drafts, and templates. */
export function Dashboard() {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const [view, setView] = useState<View>('recents');
  const [library, setLibrary] = useState<{ recents: FileEntry[]; drafts: FileEntry[] }>({ recents: [], drafts: [] });
  const [templates, setTemplates] = useState<Template[]>([]);
  const [query, setQuery] = useState('');
  const refresh = () => { api<{ recents: FileEntry[]; drafts: FileEntry[] }>('/api/library').then(setLibrary).catch(() => {}); };
  useEffect(() => {
    refresh();
    api<{ templates: Template[] }>('/api/templates').then((j) => setTemplates(j.templates)).catch(() => {});
    const h = setInterval(refresh, 5000);
    return () => clearInterval(h);
  }, []);

  const create = async (template?: Template) => {
    try {
      const { path } = await api<{ path: string }>('/api/new', template ? { template: template.id, name: template.title[lang] } : {});
      openDocument(path);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const openFile = async () => {
    const path = desktop ? await desktop.pickFile() : prompt(t.openHint)?.trim();
    if (path) openDocument(path);
  };

  const scene = view.startsWith('templates:') ? view.slice('templates:'.length) : undefined;
  const shownTemplates = useMemo(() => templates.filter((tp) => (scene === 'all' || tp.scene === scene) && match(query, [tp.title.en, tp.title.zh, tp.summary[lang], ...tp.tags])), [templates, scene, query, lang]);
  const files = (view === 'drafts' ? library.drafts : library.recents).filter((f) => match(query, [f.name, f.folder]));

  return (
    <div className={`dashboard${desktop ? ' in-desktop' : ''}`}>
      <aside className="dash-side">
        <div className="dash-logo"><span className="logo">nib</span></div>
        <NavItem icon="file" label={t.recents} active={view === 'recents'} onClick={() => setView('recents')} />
        <NavItem icon="note" label={t.drafts} active={view === 'drafts'} onClick={() => setView('drafts')} count={library.drafts.length} />
        <div className="dash-heading">{t.templates}</div>
        {SCENES.map(([id, icon]) => (
          <NavItem key={id} icon={icon} label={t.scenes[id as keyof typeof t.scenes]} active={view === `templates:${id}`} onClick={() => setView(`templates:${id}`)}
            count={id === 'all' ? templates.length : templates.filter((tp) => tp.scene === id).length} />
        ))}
        <div className="dash-foot">
          {desktop && <NavItem icon="settings" label={t.settings} active={false} onClick={() => desktop?.openSettings()} />}
          <NavItem icon="languages" label={t.language} active={false} onClick={() => { const next = lang === 'en' ? 'zh' : 'en'; localStorage.setItem('nib-lang', next); store.set({ lang: next }); }} />
        </div>
      </aside>
      <main className="dash-main">
        <header className="dash-top">
          <h1>{view === 'recents' ? t.dashboard : view === 'drafts' ? t.drafts : t.templates}</h1>
          <div className="dash-search"><Icon name="search" size={14} /><input value={query} placeholder={t.search} onChange={(e) => setQuery(e.target.value)} /></div>
          <button className="dash-button" onClick={openFile}><Icon name="folder" size={15} />{t.openFile}</button>
          <button className="dash-button primary" onClick={() => create()}><Icon name="plus" size={15} />{t.newFile}</button>
        </header>
        {view === 'recents' && <PromptBox onCreate={async (kind, text) => {
          try {
            const { path } = await api<{ path: string }>('/api/new', { name: text.slice(0, 40) || 'Untitled' });
            const request = t.agentRequest(text, t.kinds[kind as keyof typeof t.kinds], path);
            await navigator.clipboard?.writeText(request).catch(() => {});
            toast(t.requestCopied);
            openDocument(path);
          } catch (e) {
            toast((e as Error).message);
          }
        }} />}
        {scene !== undefined ? (
          <section className="dash-grid">
            {shownTemplates.map((tp) => (
              <button key={tp.id} className="dash-card" onClick={() => create(tp)} title={tp.summary[lang]}>
                <div className="dash-thumb"><img loading="lazy" src={thumbUrl({ template: tp.id, size: '480' })} alt="" /></div>
                <div className="dash-card-text">
                  <span className="dash-card-title">{tp.title[lang]}</span>
                  <span className="dash-card-sub">{t.scenes[tp.scene as keyof typeof t.scenes] ?? tp.scene} · {tp.frames > 1 ? `${tp.frames} × ` : ''}{tp.width}×{tp.height}</span>
                </div>
              </button>
            ))}
          </section>
        ) : (
          <>
            <div className="dash-section-title">{view === 'recents' ? t.recents : t.drafts}</div>
            {!files.length && <p className="empty">{view === 'recents' ? t.noRecents : t.noDrafts}</p>}
            <section className="dash-grid">
              {files.map((f) => (
                <button key={f.path} className="dash-card" onClick={() => openDocument(f.path)} title={f.path}>
                  <div className="dash-thumb"><img loading="lazy" src={thumbUrl({ path: f.path, size: '480', v: String(Math.round(f.modified)) })} alt="" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} /></div>
                  <div className="dash-card-text">
                    <span className="dash-card-title"><Icon name="file" size={13} />{f.draft ? '' : <span className="dim">{f.folder} / </span>}{f.name.replace(/\.pen$/, '')}</span>
                    <span className="dash-card-sub">{t.edited} {ago(f.modified, lang)}</span>
                  </div>
                </button>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick, count }: { icon: IconName; label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button className={`dash-nav${active ? ' active' : ''}`} onClick={onClick}>
      <Icon name={icon} size={15} /><span>{label}</span>{count ? <span className="count">{count}</span> : null}
    </button>
  );
}

/** Pick a kind, describe the design; nib makes a draft and hands the request to the user's agent. */
function PromptBox({ onCreate }: { onCreate: (kind: string, text: string) => void }) {
  const t = useT();
  const [kind, setKind] = useState('landing');
  const [text, setText] = useState('');
  return (
    <div className="prompt-box">
      <div className="chips">
        {KINDS.map(([id, icon]) => (
          <button key={id} className={`chip${kind === id ? ' on' : ''}`} onClick={() => setKind(id)}><Icon name={icon} size={14} />{t.kinds[id as keyof typeof t.kinds]}</button>
        ))}
      </div>
      <div className="prompt-field">
        <textarea value={text} placeholder={t.designAnything} rows={3} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) onCreate(kind, text.trim()); }} />
        <div className="prompt-bar">
          <span className="dim">{t.promptHint}</span>
          <button className="send" disabled={!text.trim()} onClick={() => onCreate(kind, text.trim())}><Icon name="arrowRight" size={15} /></button>
        </div>
      </div>
    </div>
  );
}

function match(query: string, fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  return !q || fields.some((f) => f.toLowerCase().includes(q));
}

function ago(ms: number, lang: string): string {
  const rtf = new Intl.RelativeTimeFormat(lang === 'zh' ? 'zh-CN' : 'en', { numeric: 'auto' });
  const s = (ms - Date.now()) / 1000;
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month'], [Infinity, 'year']];
  let v = s;
  for (const [n, unit] of steps) {
    if (Math.abs(v) < n) return rtf.format(Math.round(v), unit);
    v /= n;
  }
  return '';
}
