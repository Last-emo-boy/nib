import { useEffect, useState } from 'react';
import type { Op } from '@nib/core';
import { copyAsPng, copySelection, cutSelection, deleteSelection, duplicateSelection, frameSelection, nudge, paste, saveAs, setProps } from '../app/actions.ts';
import { Connection, authHeaders, fileFromUrl } from '../app/connection.ts';
import { useT } from '../app/i18n.ts';
import { store, toast, useEditor, type Tool } from '../app/store.ts';
import { boundsOf, CanvasView, fitView, isTyping } from '../canvas/Canvas.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { LeftPanel, layerName } from './LeftPanel.tsx';
import { Palette } from './Palette.tsx';
import { Properties } from './Properties.tsx';

export function App() {
  const [file, setFile] = useState(fileFromUrl());
  useEffect(() => {
    if (!file) return;
    sessionStorage.setItem('nib-file', file);
    document.title = `${file.split('/').pop()} · nib`;
    const conn = new Connection(file);
    store.set({ conn, doc: undefined, selection: [], changes: [] });
    const off = conn.on((e) => {
      if (e.t === 'status') store.set({ status: e.status });
      if (e.t === 'doc') store.set((s) => ({ doc: e.doc, version: s.version + 1 }));
      if (e.t === 'history') store.set({ history: { undo: e.undo, redo: e.redo } });
      if (e.t === 'change') store.set((s) => ({ version: s.version + 1, changes: [...s.changes.slice(-199), e.change] }));
    });
    return () => { off(); conn.close(); };
  }, [file]);
  useShortcuts();
  if (!file) return <OpenScreen onOpen={setFile} />;
  return (
    <div className="editor">
      <CanvasView />
      <TopLeft file={file} />
      <LeftColumn />
      <TopRight />
      <Properties />
      <Zoom />
      <ActivityFeed />
      <Status />
      <Palette />
      <Toast />
    </div>
  );
}

function TopLeft({ file }: { file: string }) {
  const name = file.split('/').pop();
  const folder = file.split('/').slice(-2, -1)[0];
  return (
    <div className="pill top-left">
      <span className="logo">nib</span>
      <span className="sep" />
      <Icon name="folder" size={15} />
      <span className="file" title={file}><span className="dim">{folder} / </span>{name}</span>
    </div>
  );
}

function LeftColumn() {
  const open = useEditor((s) => s.leftOpen);
  return (
    <div className="left-column">
      {open && <LeftPanel />}
      <ToolStrip />
    </div>
  );
}

function ToolStrip() {
  const t = useT();
  const tool = useEditor((s) => s.tool);
  const leftOpen = useEditor((s) => s.leftOpen);
  const tools: [Tool, IconName, string, string][] = [
    ['move', 'pointer', t.move, 'V'], ['frame', 'frame', t.frame, 'F'], ['rectangle', 'square', t.rectangle, 'R'],
    ['ellipse', 'circle', t.ellipse, 'O'], ['polygon', 'hexagon', t.polygon, 'P'], ['text', 'type', t.text, 'T'], ['icon', 'smile', t.iconTool, 'I'],
    ['note', 'note', t.note, 'N'], ['hand', 'hand', t.hand, 'H'],
  ];
  return (
    <div className="pill tool-strip">
      <button className={leftOpen ? 'on' : ''} title="Panel (⌘\\)" onClick={() => store.set({ leftOpen: !leftOpen })}><Icon name="panelLeft" /></button>
      <span className="hsep" />
      {tools.map(([id, icon, label, key]) => (
        <button key={id} className={tool === id ? 'active' : ''} title={`${label} (${key})`} onClick={() => store.set({ tool: id })}><Icon name={icon} /></button>
      ))}
    </div>
  );
}

function TopRight() {
  const t = useT();
  const history = useEditor((s) => s.history);
  const activity = useEditor((s) => s.activityOpen);
  const changes = useEditor((s) => s.changes);
  const lang = useEditor((s) => s.lang);
  const agentBusy = changes.length > 0 && changes[changes.length - 1].source.kind === 'agent' && Date.now() - changes[changes.length - 1].at < 4000;
  return (
    <div className="pill top-right">
      <button title={`${t.undo}${history.undo.length ? `: ${history.undo[history.undo.length - 1]}` : ''}`} disabled={!history.undo.length} onClick={() => store.get().conn?.undo()}><Icon name="undo" /></button>
      <button title={`${t.redo}${history.redo.length ? `: ${history.redo[history.redo.length - 1]}` : ''}`} disabled={!history.redo.length} onClick={() => store.get().conn?.redo()}><Icon name="redo" /></button>
      <span className="sep" />
      <button className={`text-button${activity ? ' on' : ''}`} onClick={() => store.set({ activityOpen: !activity })}>
        <span className={`dot${agentBusy ? ' busy' : ''}`} />{t.activity}
      </button>
      <button className="text-button" title={t.language} onClick={() => { const next = lang === 'en' ? 'zh' : 'en'; localStorage.setItem('nib-lang', next); store.set({ lang: next }); }}><Icon name="languages" size={15} /></button>
    </div>
  );
}

function Zoom() {
  const t = useT();
  const view = useEditor((s) => s.view);
  const zoomBy = (f: number) => {
    const { width, height } = document.querySelector('.canvas')!.getBoundingClientRect();
    const zoom = Math.max(0.02, Math.min(64, view.zoom * f));
    const cx = width / 2, cy = height / 2;
    store.set({ view: { zoom, tx: cx - ((cx - view.tx) / view.zoom) * zoom, ty: cy - ((cy - view.ty) / view.zoom) * zoom } });
  };
  return (
    <div className="pill zoom">
      <button onClick={() => zoomBy(1 / 1.25)}><Icon name="minus" size={14} /></button>
      <button className="zoom-value" title={t.zoomToFit} onClick={() => store.set({ view: fitView(boundsOf()) })}>{Math.round(view.zoom * 100)}%</button>
      <button onClick={() => zoomBy(1.25)}><Icon name="plus" size={14} /></button>
    </div>
  );
}

/** What agents and people changed, newest first; a click selects what a change touched. */
function ActivityFeed() {
  const t = useT();
  const open = useEditor((s) => s.activityOpen);
  const changes = useEditor((s) => s.changes);
  const doc = useEditor((s) => s.doc);
  if (!open || !doc) return null;
  return (
    <div className="panel activity">
      <div className="section-title"><span>{t.activity}</span><button className="icon-button" onClick={() => store.set({ activityOpen: false })}><Icon name="x" size={13} /></button></div>
      {!changes.length && <p className="empty">{t.noActivity}</p>}
      <div className="activity-list">
        {[...changes].reverse().map((c) => {
          const ids = touched(c.ops).filter((id) => doc.has(id));
          return (
            <button key={c.version} className="change" onClick={() => { if (ids.length) { store.set({ selection: ids.slice(0, 50) }); const b = boundsOf(ids); if (b) store.set({ view: fitView(b, 2) }); } }}>
              <span className={`who ${c.source.kind}`}><Icon name={c.source.kind === 'agent' ? 'bot' : 'user'} size={12} />{c.source.kind === 'agent' ? c.source.name : c.mine ? t.you : t.you}</span>
              <span className="what">{c.label.replace(/^[^:]+: /, '')}</span>
              <span className="detail">{summary(c.ops)}</span>
              <span className="when">{new Date(c.at).toLocaleTimeString()}</span>
              {ids.length > 0 && <span className="targets">{ids.slice(0, 3).map((id) => layerName(doc, doc.get(id)!)).join(', ')}{ids.length > 3 ? ` +${ids.length - 3}` : ''}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function touched(ops: Op[]): string[] {
  const ids = new Set<string>();
  for (const op of ops) {
    if (op.op === 'set') ids.add(op.id);
    if (op.op === 'insert') ids.add(op.node.id);
  }
  return [...ids];
}

function summary(ops: Op[]): string {
  const n = { insert: 0, set: 0, remove: 0, document: 0 };
  for (const op of ops) n[op.op]++;
  return [n.insert && `+${n.insert}`, n.set && `~${n.set}`, n.remove && `−${n.remove}`, n.document && 'variables'].filter(Boolean).join(' ');
}

function Status() {
  const t = useT();
  const status = useEditor((s) => s.status);
  const doc = useEditor((s) => s.doc);
  if (status === 'open' && doc) return null;
  return <div className="status-banner">{status === 'closed' ? t.disconnected : t.connecting}</div>;
}

function Toast() {
  const toast = useEditor((s) => s.toast);
  const [, tick] = useState(0);
  useEffect(() => { if (toast) { const h = setTimeout(() => tick((n) => n + 1), 4000); return () => clearTimeout(h); } }, [toast]);
  if (!toast || Date.now() - toast.at > 4000) return null;
  return <div className="toast">{toast.text}</div>;
}

function OpenScreen({ onOpen }: { onOpen: (file: string) => void }) {
  const t = useT();
  const [path, setPath] = useState('');
  const [docs, setDocs] = useState<{ path: string }[]>([]);
  useEffect(() => { fetch('/api/docs', { headers: authHeaders() }).then((r) => r.json()).then((j) => setDocs(j.docs ?? [])).catch(() => {}); }, []);
  const open = (p: string) => { location.hash = new URLSearchParams({ file: p }).toString(); onOpen(p); };
  return (
    <div className="open-screen">
      <div className="open-card">
        <div className="logo big">nib</div>
        <h1>{t.openTitle}</h1>
        <form onSubmit={(e) => { e.preventDefault(); if (path.trim()) open(path.trim()); }}>
          <input autoFocus placeholder={t.openHint} value={path} onChange={(e) => setPath(e.target.value)} />
          <button type="submit">{t.open}</button>
        </form>
        {docs.length > 0 && (
          <>
            <h2>{t.openDocs}</h2>
            {docs.map((d) => <button key={d.path} className="doc-link" onClick={() => open(d.path)}><Icon name="file" size={14} />{d.path}</button>)}
          </>
        )}
      </div>
    </div>
  );
}

/** Keyboard shortcuts, following the common design-tool set. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = store.get();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const tools: Record<string, Tool> = { v: 'move', f: 'frame', a: 'frame', r: 'rectangle', o: 'ellipse', p: 'polygon', t: 'text', i: 'icon', n: 'note', h: 'hand' };
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) s.conn?.redo(); else s.conn?.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); s.conn?.redo(); return; }
      if (mod && e.shiftKey && key === 'c') { e.preventDefault(); void copyAsPng(); return; }
      if (mod && e.shiftKey && key === 's') { e.preventDefault(); void saveAs(); return; }
      if (mod && key === 's') { e.preventDefault(); toast(store.get().lang === 'zh' ? '已自动保存：每次修改都会立即写入文件。' : 'Saved: nib writes every change to the file right away.'); return; }
      if (mod && key === 'k') { e.preventDefault(); store.set({ paletteOpen: !s.paletteOpen }); return; }
      if (mod && key === 'c') { e.preventDefault(); copySelection(); return; }
      if (mod && key === 'x') { e.preventDefault(); cutSelection(); return; }
      if (mod && key === 'v') { e.preventDefault(); void paste(); return; }
      if (mod && key === 'd') { e.preventDefault(); void duplicateSelection(); return; }
      if (mod && e.altKey && key === 'g') { e.preventDefault(); frameSelection(); return; }
      if (mod && e.altKey && key === 'k') { e.preventDefault(); void setProps(s.selection, { reusable: true }, 'Make component'); return; }
      if (mod && key === 'a') {
        e.preventDefault();
        const doc = s.doc;
        if (!doc) return;
        const parent = s.selection.length ? doc.locate(s.selection[0])?.parent ?? null : null;
        store.set({ selection: doc.siblings(parent).map((n) => n.id) });
        return;
      }
      if (mod && key === '\\') { e.preventDefault(); store.set({ leftOpen: !s.leftOpen }); return; }
      if (mod && (key === '0')) { e.preventDefault(); store.set({ view: { ...s.view, zoom: 1 } }); return; }
      if (e.shiftKey && key === '1') { store.set({ view: fitView(boundsOf()) }); return; }
      if (e.shiftKey && key === '2' && s.selection.length) { store.set({ view: fitView(boundsOf(s.selection), 4) }); return; }
      if (mod) return;
      if (key === 'backspace' || key === 'delete') { e.preventDefault(); deleteSelection(); return; }
      if (key === 'escape') {
        const parent = s.selection.length === 1 ? s.doc?.locate(s.selection[0])?.parent : undefined;
        store.set({ selection: parent ? [parent.id] : [], tool: 'move' });
        return;
      }
      if (key === 'enter' && s.selection.length === 1) {
        const n = s.doc?.get(s.selection[0]);
        if (n?.type === 'text') store.set({ editingText: n.id });
        else { const kid = (n as { children?: { id: string }[] } | undefined)?.children?.[0]; if (kid) store.set({ selection: [kid.id] }); }
        return;
      }
      const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[key]) { e.preventDefault(); const [dx, dy] = arrows[key]; const step = e.shiftKey ? 10 : 1; nudge(dx * step, dy * step); return; }
      if (tools[key]) { store.set({ tool: tools[key] }); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
