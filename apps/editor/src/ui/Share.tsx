import { useEffect, useRef, useState } from 'react';
import { authHeaders } from '../app/connection.ts';
import { desktop } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { post } from '../app/libraries.ts';
import { toast, useEditor } from '../app/store.ts';
import { Icon } from './Icon.tsx';

interface ShareState { id?: string; url?: string; lanUrl?: string; folder?: string; lan?: boolean }

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
        </div>
      )}
    </div>
  );
}
