import { useEffect, useRef, useState } from 'react';
import { useT } from '../app/i18n.ts';
import { post } from '../app/libraries.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { boundsOf, fitView } from '../canvas/Canvas.tsx';
import { Icon } from './Icon.tsx';

interface Result { text: string; images: { data: string; mimeType: string }[]; isError?: boolean }
interface Picked { selector: string; tag: string; rect: { x: number; y: number; width: number; height: number } }

const RECENT_KEY = 'nib-browser-recent';
const recent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as string[]; } catch { return []; } };

/**
 * A web page beside the canvas: load a url, look at it, pick an element, and bring the page or the
 * element into the design as editable layers or as a screenshot.
 */
export function BrowserPanel() {
  const t = useT();
  const open = useEditor((s) => s.browserOpen);
  const conn = useEditor((s) => s.conn);
  const [url, setUrl] = useState(recent()[0] ?? '');
  const [shot, setShot] = useState<{ src: string; width: number; height: number; url: string } | undefined>();
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Picked | undefined>();
  const [up, setUp] = useState(0);
  const [busy, setBusy] = useState<string | undefined>();
  const at = useRef<{ x: number; y: number } | undefined>(undefined);
  useEffect(() => { if (!open) setPicking(false); }, [open]);
  if (!open || !conn) return null;

  const run = async (key: string, args: Record<string, unknown>): Promise<Result | undefined> => {
    setBusy(key);
    try {
      const r = await post<Result>('/api/browser', { filePath: conn.path, ...args });
      if (r.isError) { toast(r.text); return undefined; }
      return r;
    } catch (e) {
      toast((e as Error).message);
      return undefined;
    } finally {
      setBusy(undefined);
    }
  };
  const look = async () => {
    const r = await run('look', { action: 'return-screenshot', width: 760 });
    const m = r && /on (\S+) \((\d+)×(\d+)\)\.$/.exec(r.text);
    if (r?.images[0] && m) setShot({ src: `data:${r.images[0].mimeType};base64,${r.images[0].data}`, url: m[1], width: Number(m[2]), height: Number(m[3]) });
  };
  const load = async (target = url) => {
    const u = target.trim();
    if (!u) return;
    const full = /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`;
    setUrl(full);
    setPicked(undefined);
    if (!(await run('load', { action: 'load-page', url: full }))) return;
    localStorage.setItem(RECENT_KEY, JSON.stringify([full, ...recent().filter((x) => x !== full)].slice(0, 8)));
    await look();
  };
  const pick = async (e: React.MouseEvent<HTMLImageElement>, levels = 0) => {
    if (!shot) return;
    const r = e.currentTarget.getBoundingClientRect();
    at.current = { x: ((e.clientX - r.left) / r.width) * shot.width, y: ((e.clientY - r.top) / r.height) * shot.height };
    await choose(levels);
  };
  const choose = async (levels: number) => {
    if (!at.current) return;
    const r = await run('pick', { action: 'element-at', point: at.current, up: levels });
    if (r) { setPicked(JSON.parse(r.text) as Picked); setUp(levels); setPicking(false); }
  };
  /** Bring the page or the picked element in, then show what arrived. */
  const bring = async (key: string, action: string) => {
    const before = new Set(store.get().doc?.data.children.map((n) => n.id));
    const r = await run(key, { action, ...(picked ? { target: 'query', querySelector: picked.selector } : { target: 'full-page' }) });
    if (!r) return;
    toast(r.text.split('. ')[0]);
    setTimeout(() => {
      const added = store.get().doc?.data.children.filter((n) => !before.has(n.id)).map((n) => n.id) ?? [];
      if (added.length) { store.set({ selection: added }); const b = boundsOf(added); if (b) store.set({ view: fitView(b) }); }
    }, 400);
  };

  return (
    <div className="panel browser-panel">
      <div className="agent-head">
        <Icon name="globe" size={14} />
        <span className="browser-title">{t.browser}</span>
        <button className="icon-button" title={t.close} onClick={() => store.set({ browserOpen: false })}><Icon name="x" size={14} /></button>
      </div>
      <form className="browser-url" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <input value={url} list="nib-browser-recent" placeholder="https://…" onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <datalist id="nib-browser-recent">{recent().map((u) => <option key={u} value={u} />)}</datalist>
        <button type="submit" disabled={!url.trim() || !!busy}>{busy === 'load' ? <span className="spinner" /> : t.go}</button>
      </form>
      <div className="browser-view">
        {!shot && <p className="empty">{busy ? t.loading : t.browserHint}</p>}
        {shot && (
          <div className={`browser-shot${picking ? ' picking' : ''}`}>
            <img src={shot.src} alt="" draggable={false} onClick={(e) => picking && void pick(e)} />
            {picked && (
              <div className="browser-pick" style={{ left: `${(picked.rect.x / shot.width) * 100}%`, top: `${(picked.rect.y / shot.height) * 100}%`, width: `${(picked.rect.width / shot.width) * 100}%`, height: `${(picked.rect.height / shot.height) * 100}%` }} />
            )}
          </div>
        )}
      </div>
      {shot && (
        <div className="browser-actions">
          <div className="browser-row">
            <button className={`browser-button${picking ? ' on' : ''}`} onClick={() => setPicking(!picking)}><Icon name="pointer" size={13} />{picking ? t.clickElement : t.pickElement}</button>
            {picked && <button className="browser-button" title={t.parentElement} disabled={!!busy} onClick={() => void choose(up + 1)}><Icon name="arrowRight" size={13} />{t.parentElement}</button>}
            {picked && <button className="browser-button" onClick={() => { setPicked(undefined); setUp(0); }}><Icon name="x" size={13} /></button>}
            <span className="grow" />
            <button className="browser-button" title={t.refresh} disabled={!!busy} onClick={() => void look()}><Icon name="redo" size={13} /></button>
          </div>
          <div className="browser-target">{picked ? <><code>{picked.tag}</code> {Math.round(picked.rect.width)}×{Math.round(picked.rect.height)}</> : t.wholePage}</div>
          <div className="browser-row">
            <button className="browser-primary" disabled={!!busy} onClick={() => void bring('import', 'import-to-canvas')}>{busy === 'import' ? <span className="spinner" /> : <Icon name="layers" size={13} />}{t.importLayers}</button>
            <button className="browser-button" disabled={!!busy} onClick={() => void bring('shot', 'screenshot-to-canvas')}>{busy === 'shot' ? <span className="spinner" /> : <Icon name="image" size={13} />}{t.importScreenshot}</button>
          </div>
        </div>
      )}
    </div>
  );
}
