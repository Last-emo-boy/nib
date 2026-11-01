import { useEffect, useState } from 'react';
import { commit } from '../app/actions.ts';
import { authHeaders } from '../app/connection.ts';
import { useT } from '../app/i18n.ts';
import { moveSlide } from '../app/slides.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { boundsOf, fitView } from '../canvas/Canvas.tsx';
import { slideIds, startPresenting } from '../canvas/present.tsx';
import { Icon } from './Icon.tsx';
import { layerName } from './LeftPanel.tsx';
import { NodeImage } from '../web/preview.tsx';

/** The design's slides (top-level frames in reading order): pick, reorder by dragging, present, save as PDF. */
export function Slides() {
  const t = useT();
  const doc = useEditor((s) => s.doc);
  const conn = useEditor((s) => s.conn);
  const selection = useEditor((s) => s.selection);
  const web = useEditor((s) => s.web);
  useEditor((s) => s.layoutVersion);
  const version = useEditor((s) => s.version);
  // Thumbnails follow edits, but not on every keystroke.
  const [shown, setShown] = useState(version);
  useEffect(() => { const h = setTimeout(() => setShown(version), 1200); return () => clearTimeout(h); }, [version]);
  const [dragging, setDragging] = useState<number | undefined>();
  const [busy, setBusy] = useState(false);
  if (!doc || !conn) return null;
  const ids = slideIds();
  const reorder = (from: number, to: number) => {
    const places = Object.fromEntries(ids.map((id) => { const n = doc.get(id)!; return [id, { x: n.x ?? 0, y: n.y ?? 0 }]; }));
    const moves = moveSlide(ids, places, from, to);
    void commit('Reorder slides', (ed) => { for (const [id, p] of Object.entries(moves)) ed.set(id, p); });
  };
  const pdf = async () => {
    setBusy(true);
    try {
      const r = await fetch('/api/export', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ filePath: conn.path, ids, format: 'pdf' }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      for (const f of j.files as { name: string; data: string }[]) {
        const url = URL.createObjectURL(new Blob([Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0))], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      toast(`PDF: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  if (!ids.length) return <p className="empty">{t.noSlides}</p>;
  return (
    <div className="slides">
      <div className="slides-actions">
        <button className="dash-button" onClick={() => startPresenting()}><Icon name="play" size={13} /> {t.present}</button>
        {!web && <button className="dash-button" disabled={busy} onClick={() => void pdf()}><Icon name="download" size={13} /> PDF</button>}
      </div>
      {ids.map((id, i) => {
        const n = doc.get(id)!;
        return (
          <div key={id} className={`slide-row${selection.includes(id) ? ' selected' : ''}${dragging === i ? ' dragging' : ''}`} draggable
            onDragStart={(e) => { setDragging(i); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => setDragging(undefined)}
            onDragOver={(e) => { if (dragging !== undefined) e.preventDefault(); }}
            onDrop={(e) => { e.preventDefault(); if (dragging !== undefined && dragging !== i) reorder(dragging, i); setDragging(undefined); }}
            onClick={() => { store.set({ selection: [id] }); const b = boundsOf([id]); if (b) store.set({ view: fitView(b, 1.2) }); }}
            onDoubleClick={() => startPresenting(id)}>
            <span className="slide-number">{i + 1}</span>
            <NodeImage className="slide-thumb" path={conn.path} id={id} version={shown} alt="" draggable={false} />
            <span className="slide-name">{layerName(doc, n)}</span>
          </div>
        );
      })}
    </div>
  );
}
