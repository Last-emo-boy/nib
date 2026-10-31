import { useEffect, useRef, useState } from 'react';
import { authHeaders } from '../app/connection.ts';
import { desktop } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { post } from '../app/libraries.ts';
import { toast, useEditor } from '../app/store.ts';
import { Icon } from './Icon.tsx';

interface ShareState { id?: string; url?: string; lanUrl?: string; folder?: string; lan?: boolean }

interface W33dStatus { available: boolean; signedIn: boolean; email?: string }
interface W33dSite { slug: string; visibility: 'public' | 'private'; url: string }

/**
 * Publish to w33d: the design as a website (a page per frame, prototype links as links) on nib.w33d.xyz,
 * public or for w33d users only. Needs a w33d sign-in; nothing else in nib does.
 */
function PublishW33d({ path, visit, copy }: { path: string; visit: (url: string) => void; copy: (url: string) => void }) {
  const t = useT();
  const [status, setStatus] = useState<W33dStatus>();
  const [site, setSite] = useState<W33dSite>();
  const [slug, setSlug] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [busy, setBusy] = useState<string>();
  const get = async <T,>(p: string): Promise<T> => (await fetch(p, { headers: authHeaders() })).json() as Promise<T>;
  const refresh = async () => {
    const [st, s] = await Promise.all([get<W33dStatus>('/api/w33d/status'), get<{ site?: W33dSite; suggested: string }>(`/api/w33d/site?${new URLSearchParams({ doc: path })}`)]);
    setStatus(st);
    setSite(s.site);
    setSlug((v) => v || s.site?.slug || s.suggested);
    if (s.site) setVisibility(s.site.visibility);
  };
  useEffect(() => { void refresh(); }, [path]);
  if (!status?.available) return null;
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try { await fn(); } catch (e) { toast((e as Error).message); } finally { setBusy(undefined); }
  };
  const signIn = () => run('signin', async () => {
    const { url } = await post<{ url: string }>('/api/w33d/login', {});
    visit(url);
    // The browser comes back to nib's daemon; wait for it (at most a few minutes).
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const st = await get<W33dStatus>('/api/w33d/status');
      if (st.signedIn) { setStatus(st); return; }
    }
  });
  const publish = () => run('publish', async () => {
    const r = await post<{ site: W33dSite }>('/api/w33d/publish', { path, slug, visibility });
    setSite(r.site);
    toast(t.published);
  });
  return (
    <div className="w33d">
      <div className="w33d-title">{t.publishW33d}</div>
      {!status.signedIn ? (
        <>
          <p className="dim">{t.publishW33dHint}</p>
          <button className="dash-button" disabled={!!busy} onClick={() => void signIn()}>{busy === 'signin' ? t.waitingSignIn : t.signInW33d}</button>
        </>
      ) : (
        <>
          <div className="w33d-who"><span className="dim">{status.email ?? 'w33d'}</span><button className="link" onClick={() => void post('/api/w33d/logout', {}).then(refresh)}>{t.signOut}</button></div>
          <label className="w33d-slug"><span className="dim">nib.w33d.xyz/{visibility === 'public' ? 's' : 'p'}/</span>
            <input value={slug} disabled={!!site} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40))} />
          </label>
          <div className="segmented">
            <button className={visibility === 'public' ? 'on' : ''} onClick={() => setVisibility('public')}>{t.visibilityPublic}</button>
            <button className={visibility === 'private' ? 'on' : ''} onClick={() => setVisibility('private')}>{t.visibilityPrivate}</button>
          </div>
          <button className="dash-button" disabled={!!busy || !slug} onClick={() => void publish()}>{busy === 'publish' ? t.publishing : site ? t.updateSite : t.publishSite}</button>
          {site && (
            <>
              <div className="share-link">
                <input readOnly value={site.url} onFocus={(e) => e.target.select()} />
                <button className="icon-button" title={t.copy} onClick={() => copy(site.url)}><Icon name="copy" size={13} /></button>
                <button className="icon-button" title={t.openLink} onClick={() => visit(site.url)}><Icon name="link" size={13} /></button>
              </div>
              <button className="link danger" disabled={!!busy} onClick={() => { if (confirm(t.unpublishConfirm)) void run('down', async () => { await post('/api/w33d/unpublish', { path }); setSite(undefined); }); }}>{t.unpublish}</button>
            </>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Share: a read-only snapshot of the design with a link (this computer), optionally reachable on the local
 * network, in a folder any static host can serve.
 */
export function ShareButton() {
  const t = useT();
  const conn = useEditor((s) => s.conn);
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ShareState>({});
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !conn) return;
    void fetch(`/api/share?${new URLSearchParams({ doc: conn.path })}`, { headers: authHeaders() }).then((r) => r.json()).then(setState);
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  if (!conn) return null;
  const share = async () => {
    setBusy(true);
    try {
      setState(await post<ShareState>('/api/share', { path: conn.path }));
    } catch (e) {
      toast(`${t.share}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  const setLan = async (on: boolean) => {
    await post('/api/share/lan', { on });
    setState(await (await fetch(`/api/share?${new URLSearchParams({ doc: conn.path })}`, { headers: authHeaders() })).json());
  };
  const visit = (url: string) => (desktop ? desktop.openExternal(url) : window.open(url, '_blank', 'noopener'));
  const copy = (url: string) => { void navigator.clipboard?.writeText(url); toast(t.linkCopied); };
  const link = (url: string) => (
    <div className="share-link">
      <input readOnly value={url} onFocus={(e) => e.target.select()} />
      <button className="icon-button" title={t.copy} onClick={() => copy(url)}><Icon name="copy" size={13} /></button>
      <button className="icon-button" title={t.openLink} onClick={() => visit(url)}><Icon name="link" size={13} /></button>
    </div>
  );
  return (
    <div className="share" ref={root}>
      <button className={`text-button${open ? ' on' : ''}`} onClick={() => setOpen(!open)}>{t.share}</button>
      {open && (
        <div className="share-menu">
          <p className="dim">{t.shareHint}</p>
          <button className="dash-button" disabled={busy} onClick={() => void share()}>{busy ? t.loading : state.id ? t.updateShare : t.createShare}</button>
          {state.url && link(state.url)}
          <label className="check">
            <input type="checkbox" checked={!!state.lan} onChange={(e) => void setLan(e.target.checked)} /> {t.shareOnNetwork}
          </label>
          {state.lan && <p className="dim">{t.shareNetworkHint}</p>}
          {state.lanUrl && link(state.lanUrl)}
          {state.folder && (
            desktop
              ? <button className="link" onClick={() => desktop!.revealInFolder(state.folder!)}><Icon name="folder" size={12} /> {t.shareFolder}</button>
              : <p className="dim share-folder">{state.folder}</p>
          )}
          <PublishW33d path={conn.path} visit={visit} copy={copy} />
        </div>
      )}
    </div>
  );
}
