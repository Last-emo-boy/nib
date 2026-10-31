import { useEffect, useState } from 'react';
import type { Op } from '@nib/core';
import { copyAsPng, copySelection, deleteSelection, duplicateSelection, frameSelection, nudge, paste, saveAs, setProps } from '../app/actions.ts';
import { Connection, authHeaders, fileFromUrl } from '../app/connection.ts';
import { desktop, openDashboard } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { store, toast, toggleSide, useEditor, type Tool } from '../app/store.ts';
import { boundsOf, canvas, CanvasView, fitView, importImages, isImageFile, isTyping, pickImages } from '../canvas/Canvas.tsx';
import { imageFillIndex } from '../canvas/crop.ts';
import { isMask, maskSelection, releaseMask } from '../canvas/mask.ts';
import { arrange, flipSelection } from '../canvas/arrange.ts';
import { layerOf } from '../app/parts.ts';
import { Present, startPresenting } from '../canvas/present.tsx';
import { followLink } from '../canvas/links.ts';
import { deletePoints, editPath, finishDrawing, finishEditing } from '../canvas/pen.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { LeftPanel, layerName } from './LeftPanel.tsx';
import { Dashboard } from './Dashboard.tsx';
import { Settings } from './Settings.tsx';
import { Palette } from './Palette.tsx';
import { Properties } from './Properties.tsx';
import { agentLabel } from '../canvas/presence.ts';
import { receive as receiveAgent } from '../app/agent.ts';
import { AgentPanel } from './Agent.tsx';
import { BrowserPanel } from './Browser.tsx';

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
      if (e.t === 'agent') receiveAgent(e.event);
    });
    return () => { off(); conn.close(); };
  }, [file]);
  useShortcuts();
  const presenting = useEditor((s) => !!s.present);
  if (new URLSearchParams(location.hash.slice(1)).get('view') === 'settings') return <Settings />;
  if (!file) return <Dashboard />;
  if (presenting) return <div className="editor presenting"><CanvasView /><Present onClick={followLink} /><Toast /></div>;
  return (
    <div className={`editor${desktop ? ' in-desktop-editor' : ''}`}>
      <CanvasView />
      <TopLeft file={file} />
      <LeftColumn />
      <TopRight />
      <Properties />
      <Zoom />
      <ActivityFeed />
      <AgentPanel />
      <BrowserPanel />
      <Status />
      <Palette />
      <Toast />
    </div>
  );
}

function TopLeft({ file }: { file: string }) {
  const t = useT();
  const name = file.split('/').pop();
  const folder = file.split('/').slice(-2, -1)[0];
  return (
    <div className="pill top-left">
      <span className="logo">nib</span>
      <button className="icon-button" title={t.dashboardButton} onClick={openDashboard}><Icon name="grid" size={15} /></button>
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
    ['move', 'pointer', t.move, 'V'], ['scale', 'scaling', t.scaleTool, 'K'], ['frame', 'frame', t.frame, 'F'], ['rectangle', 'square', t.rectangle, 'R'],
    ['ellipse', 'circle', t.ellipse, 'O'], ['polygon', 'hexagon', t.polygon, ''], ['pen', 'penTool', t.pen, 'P'], ['text', 'type', t.text, 'T'], ['icon', 'smile', t.iconTool, 'I'],
    ['note', 'note', t.note, 'N'], ['hand', 'hand', t.hand, 'H'],
  ];
  return (
    <div className="pill tool-strip">
      <button className={leftOpen ? 'on' : ''} title="Panel (⌘\\)" onClick={() => store.set({ leftOpen: !leftOpen })}><Icon name="panelLeft" /></button>
      <span className="hsep" />
      {tools.map(([id, icon, label, key]) => (
        <button key={id} className={tool === id ? 'active' : ''} title={key ? `${label} (${key})` : label} onClick={() => store.set({ tool: id })}><Icon name={icon} /></button>
      ))}
    </div>
  );
}

function TopRight() {
  const t = useT();
  const history = useEditor((s) => s.history);
  const activity = useEditor((s) => s.activityOpen);
  const agentOpen = useEditor((s) => s.agentOpen);
  const browserOpen = useEditor((s) => s.browserOpen);
  const changes = useEditor((s) => s.changes);
  const lang = useEditor((s) => s.lang);
  const agentBusy = changes.length > 0 && changes[changes.length - 1].source.kind === 'agent' && Date.now() - changes[changes.length - 1].at < 4000;
  return (
    <div className="pill top-right">
      <button title={`${t.undo}${history.undo.length ? `: ${history.undo[history.undo.length - 1]}` : ''}`} disabled={!history.undo.length} onClick={() => store.get().conn?.undo()}><Icon name="undo" /></button>
      <button title={`${t.redo}${history.redo.length ? `: ${history.redo[history.redo.length - 1]}` : ''}`} disabled={!history.redo.length} onClick={() => store.get().conn?.redo()}><Icon name="redo" /></button>
      <span className="sep" />
      <button className={`text-button${agentOpen ? ' on' : ''}`} title={`${t.agent} (⌘J)`} onClick={() => toggleSide('agentOpen')}>
        <Icon name="sparkles" size={15} />{t.agent}
      </button>
      <button className={`text-button${browserOpen ? ' on' : ''}`} title={t.browser} onClick={() => toggleSide('browserOpen')}><Icon name="globe" size={15} /></button>
      <button className={`text-button${activity ? ' on' : ''}`} onClick={() => toggleSide('activityOpen')}>
        <span className={`dot${agentBusy ? ' busy' : ''}`} />{t.activity}
      </button>
      <button className="text-button" title={`${t.present} (⌥⌘↵)`} onClick={() => startPresenting()}><Icon name="play" size={15} /></button>
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
              <span className={`who ${c.source.kind}`}><Icon name={c.source.kind === 'agent' ? 'bot' : 'user'} size={12} />{c.source.kind === 'agent' ? agentLabel(c.source.name) : t.you}</span>
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

/** Editor commands, shared by keyboard shortcuts and the desktop app's menus. */
export function runCommand(name: string): void {
  const s = store.get();
  const typing = isTypingTarget(document.activeElement);
  const zoomBy = (f: number) => {
    const { width, height } = document.querySelector('.canvas')?.getBoundingClientRect() ?? { width: 0, height: 0 };
    const zoom = Math.max(0.02, Math.min(64, s.view.zoom * f));
    const cx = width / 2, cy = height / 2;
    store.set({ view: { zoom, tx: cx - ((cx - s.view.tx) / s.view.zoom) * zoom, ty: cy - ((cy - s.view.ty) / s.view.zoom) * zoom } });
  };
  switch (name) {
    case 'undo': if (typing) document.execCommand('undo'); else s.conn?.undo(); break;
    case 'redo': if (typing) document.execCommand('redo'); else s.conn?.redo(); break;
    case 'duplicate': if (!typing) void duplicateSelection(); break;
    case 'delete': if (!typing) deleteSelection(); break;
    case 'select-all': {
      if (typing) { document.execCommand('selectAll'); break; }
      const doc = s.doc;
      if (!doc) break;
      const parent = s.selection.length ? doc.locate(s.selection[0])?.parent ?? null : null;
      store.set({ selection: doc.siblings(parent).map((n) => n.id) });
      break;
    }
    case 'palette': store.set({ paletteOpen: !s.paletteOpen }); break;
    case 'zoom-in': zoomBy(1.25); break;
    case 'zoom-out': zoomBy(1 / 1.25); break;
    case 'zoom-100': store.set({ view: { ...s.view, zoom: 1 } }); break;
    case 'zoom-fit': store.set({ view: fitView(boundsOf()) }); break;
    case 'zoom-selection': if (s.selection.length) store.set({ view: fitView(boundsOf(s.selection), 4) }); break;
    case 'toggle-panel': store.set({ leftOpen: !s.leftOpen }); break;
    case 'toggle-activity': toggleSide('activityOpen'); break;
    case 'toggle-agent': toggleSide('agentOpen'); break;
    case 'save-as': void saveAs(); break;
    case 'export': store.set({ leftOpen: s.leftOpen }); document.querySelector<HTMLButtonElement>('.wide-button')?.scrollIntoView({ block: 'center' }); break;
    case 'frame-selection': frameSelection(); break;
    case 'make-component': void setProps(s.selection, { reusable: true }, 'Make component'); break;
    case 'copy-png': void copyAsPng(); break;
    case 'mask': if (!typing) { const one = s.selection.length === 1 ? s.doc?.get(s.selection[0]) : undefined; if (isMask(one)) releaseMask(); else maskSelection(); } break;
    case 'release-mask': if (!typing) releaseMask(); break;
    case 'place-image': pickImages(); break;
    case 'present': startPresenting(); break;
    case 'bring-forward': if (!typing) arrange('forward'); break;
    case 'send-backward': if (!typing) arrange('backward'); break;
    case 'bring-to-front': if (!typing) arrange('front'); break;
    case 'send-to-back': if (!typing) arrange('back'); break;
    case 'flip-horizontal': if (!typing) flipSelection('x'); break;
    case 'flip-vertical': if (!typing) flipSelection('y'); break;
    case 'toggle-pixel-grid': { const on = !s.pixelGrid; localStorage.setItem('nib-pixel-grid', on ? '1' : '0'); store.set({ pixelGrid: on }); break; }
  }
}

const isTypingTarget = (t: Element | null) => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || (t as HTMLElement).isContentEditable);

/** Keyboard shortcuts, following the common design-tool set; the clipboard goes through copy/cut/paste events. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const s = store.get();
      // Present mode has keys of its own.
      if (s.present) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const tools: Record<string, Tool> = { v: 'move', k: 'scale', f: 'frame', a: 'frame', r: 'rectangle', o: 'ellipse', p: 'pen', t: 'text', i: 'icon', n: 'note', h: 'hand' };
      const chords: Record<string, string> = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'duplicate', k: 'palette', j: 'toggle-agent', a: 'select-all', '\\': 'toggle-panel', '0': 'zoom-100', '=': 'zoom-in', '-': 'zoom-out' };
      if (e.metaKey && e.ctrlKey && (key === 'm' || e.code === 'KeyM')) { e.preventDefault(); runCommand('mask'); return; }
      if (mod && e.altKey && key === 'enter') { e.preventDefault(); runCommand('present'); return; }
      if (mod && e.shiftKey && key === 'k') { e.preventDefault(); runCommand('place-image'); return; }
      // Stacking order: ⌘] ⌘[ one step, ⌥⌘] ⌥⌘[ all the way (e.code, since Alt changes the character).
      if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft')) { e.preventDefault(); runCommand(`${e.code === 'BracketRight' ? (e.altKey ? 'bring-to-front' : 'bring-forward') : (e.altKey ? 'send-to-back' : 'send-backward')}`); return; }
      if (mod && e.altKey && key === 'g') { e.preventDefault(); runCommand('frame-selection'); return; }
      if (mod && e.altKey && key === 'k') { e.preventDefault(); runCommand('make-component'); return; }
      if (mod && e.shiftKey && key === 'c') { e.preventDefault(); runCommand('copy-png'); return; }
      if (mod && e.shiftKey && key === 's') { e.preventDefault(); runCommand('save-as'); return; }
      if (mod && key === 's') { e.preventDefault(); toast(s.lang === 'zh' ? '已自动保存：每次修改都会立即写入文件。' : 'Saved: nib writes every change to the file right away.'); return; }
      if (mod && chords[key]) { e.preventDefault(); runCommand(chords[key]); return; }
      if (e.shiftKey && (key === '"' || e.code === 'Quote')) { runCommand('toggle-pixel-grid'); return; }
      if (e.shiftKey && !mod && !e.altKey && (e.code === 'KeyH' || e.code === 'KeyV')) { runCommand(e.code === 'KeyH' ? 'flip-horizontal' : 'flip-vertical'); return; }
      if (e.shiftKey && key === '!') { runCommand('zoom-fit'); return; }
      if (e.shiftKey && (key === '1')) { runCommand('zoom-fit'); return; }
      if (e.shiftKey && (key === '2' || key === '@')) { runCommand('zoom-selection'); return; }
      if (mod) return;
      if (key === 'escape' && s.gradientEdit) { store.set({ gradientEdit: undefined }); return; }
      if ((key === 'escape' || key === 'enter') && s.crop) { e.preventDefault(); store.set({ crop: undefined }); return; }
      // While a path is drawn or its points edited, these keys work on its points.
      if (s.pen) {
        if (key === 'escape' || key === 'enter') { e.preventDefault(); if (s.pen.mode === 'draw') void finishDrawing(); else finishEditing(); return; }
        if (key === 'backspace' || key === 'delete') { e.preventDefault(); deletePoints(); return; }
      }
      if (key === 'backspace' || key === 'delete') { e.preventDefault(); deleteSelection(); return; }
      if (key === 'escape') {
        // Up one level: to the parent, or from a part of an instance to what holds it.
        const parent = s.selection.length === 1 ? canvas.cache?.placed(s.selection[0])?.parentId ?? s.doc?.locate(s.selection[0])?.parent?.id : undefined;
        store.set({ selection: parent ? [parent] : [], tool: 'move' });
        return;
      }
      if (key === 'enter' && s.selection.length === 1) {
        const n = s.doc ? layerOf(s.doc, s.selection[0]) : undefined;
        if (n?.type === 'text') store.set({ editingText: n.id });
        else if (n?.type === 'path') editPath(n.id);
        else if (imageFillIndex(n) >= 0) store.set({ crop: { id: n!.id, index: imageFillIndex(n) } });
        else { const kid = canvas.cache?.childrenOf(s.selection[0])[0]; if (kid) store.set({ selection: [kid] }); }
        return;
      }
      const arrows: Record<string, [number, number]> = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };
      if (arrows[key]) { e.preventDefault(); const [dx, dy] = arrows[key]; const step = e.shiftKey ? s.prefs.bigNudge : s.prefs.nudge; nudge(dx * step, dy * step); return; }
      if (tools[key]) { store.set({ tool: tools[key] }); return; }
    };
    const onCopy = (e: ClipboardEvent) => { if (isTypingTarget(document.activeElement) || !store.get().selection.length) return; e.preventDefault(); copySelection(e.clipboardData ?? undefined); };
    const onCut = (e: ClipboardEvent) => { if (isTypingTarget(document.activeElement) || !store.get().selection.length) return; e.preventDefault(); copySelection(e.clipboardData ?? undefined); deleteSelection(); };
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(document.activeElement)) return;
      e.preventDefault();
      // A copied picture (a screenshot, an image from a browser) is placed as an image.
      const images = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      if (images.length && !e.clipboardData?.getData('text/plain').trim().startsWith('{')) { void importImages(images); return; }
      void paste(e.clipboardData?.getData('text/plain'));
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    const offDesktop = desktop?.onCommand(runCommand);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
      offDesktop?.();
    };
  }, []);
}
