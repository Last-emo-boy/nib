import { useEffect, useMemo, useRef, useState } from 'react';
import { childrenOf } from '@nib/core';
import type { Node } from '@nib/format';
import { copyAsHtml, copyAsPng, copyAsReact, copySelection, cutSelection, deleteSelection, duplicateSelection, frameSelection, paste, saveAs } from '../app/actions.ts';
import { useT } from '../app/i18n.ts';
import { store, toast, useEditor, type Tool, toggleSide } from '../app/store.ts';
import { boundsOf, fitView, importSvg, pickImages } from '../canvas/Canvas.tsx';
import { maskSelection, releaseMask } from '../canvas/mask.ts';
import { arrange, flipSelection } from '../canvas/arrange.ts';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { layerName, typeIcon } from './LeftPanel.tsx';
import { loadAgent, sendMessage, useAgent } from '../app/agent.ts';

interface Item { key: string; label: string; hint?: string; icon: IconName; run: () => void }

const MAX_LAYERS = 4000;

/** One search box for every command and every named layer (Cmd/Ctrl+K). */
export function Palette() {
  const t = useT();
  const open = useEditor((s) => s.paletteOpen);
  const doc = useEditor((s) => s.doc);
  const version = useEditor((s) => s.version);
  const macros = useAgent((s) => s.macros);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setQuery(''); setActive(0); setTimeout(() => input.current?.focus(), 0); } }, [open]);

  const commands = useMemo<Item[]>(() => {
    const tool = (id: Tool, label: string, icon: IconName, hint: string): Item => ({ key: `tool:${id}`, label, icon, hint, run: () => store.set({ tool: id }) });
    return [
      tool('move', t.move, 'pointer', 'V'), tool('scale', t.scaleTool, 'scaling', 'K'), tool('frame', t.frame, 'frame', 'F'), tool('rectangle', t.rectangle, 'square', 'R'),
      tool('ellipse', t.ellipse, 'circle', 'O'), tool('polygon', t.polygon, 'hexagon', ''), tool('pen', t.pen, 'penTool', 'P'), tool('pencil', t.pencil, 'pencil', '⇧P'), tool('text', t.text, 'type', 'T'),
      tool('icon', t.iconTool, 'smile', 'I'), tool('note', t.note, 'note', 'N'), tool('hand', t.hand, 'hand', 'H'),
      { key: 'import-svg', label: t.importSvg, icon: 'penTool', run: () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.svg,image/svg+xml';
        input.onchange = () => { const f = input.files?.[0]; if (f) void f.text().then((text) => importSvg(text, undefined, f.name.replace(/\.svg$/i, ''))); };
        input.click();
      } },
      { key: 'bring-forward', label: t.bringForward, icon: 'bringToFront', hint: '⌘]', run: () => arrange('forward') },
      { key: 'send-backward', label: t.sendBackward, icon: 'sendToBack', hint: '⌘[', run: () => arrange('backward') },
      { key: 'bring-to-front', label: t.bringToFront, icon: 'bringToFront', hint: '⌥⌘]', run: () => arrange('front') },
      { key: 'send-to-back', label: t.sendToBack, icon: 'sendToBack', hint: '⌥⌘[', run: () => arrange('back') },
      { key: 'flip-h', label: t.flipHorizontal, icon: 'flipH', hint: '⇧H', run: () => flipSelection('x') },
      { key: 'flip-v', label: t.flipVertical, icon: 'flipV', hint: '⇧V', run: () => flipSelection('y') },
      { key: 'place-image', label: t.placeImage, icon: 'image', hint: '⇧⌘K', run: pickImages },
      { key: 'mask', label: t.useAsMask, icon: 'mask', hint: '⌃⌘M', run: maskSelection },
      { key: 'release-mask', label: t.releaseMask, icon: 'mask', run: releaseMask },
      { key: 'copy-png', label: t.copyPng, icon: 'image', hint: '⇧⌘C', run: () => void copyAsPng() },
      { key: 'copy-html', label: t.copyHtml, icon: 'copy', run: () => void copyAsHtml() },
      { key: 'copy-tailwind', label: t.copyTailwind, icon: 'copy', run: () => void copyAsHtml(true) },
      { key: 'copy-react', label: t.copyReact, icon: 'copy', run: () => void copyAsReact() },
      { key: 'save-as', label: t.saveAs, icon: 'file', hint: '⇧⌘S', run: () => void saveAs() },
      { key: 'undo', label: t.undo, icon: 'undo', hint: '⌘Z', run: () => store.get().conn?.undo() },
      { key: 'redo', label: t.redo, icon: 'redo', hint: '⇧⌘Z', run: () => store.get().conn?.redo() },
      { key: 'copy', label: t.copy, icon: 'copy', hint: '⌘C', run: copySelection },
      { key: 'cut', label: t.cut, icon: 'copy', hint: '⌘X', run: cutSelection },
      { key: 'paste', label: t.paste, icon: 'copy', hint: '⌘V', run: () => void paste() },
      { key: 'duplicate', label: t.duplicate, icon: 'copy', hint: '⌘D', run: () => void duplicateSelection() },
      { key: 'delete', label: t.delete, icon: 'trash', hint: '⌫', run: deleteSelection },
      { key: 'frame-selection', label: t.frameSelection, icon: 'frame', hint: '⌥⌘G', run: frameSelection },
      { key: 'fit', label: t.fitAll, icon: 'maximize', hint: '⇧1', run: () => store.set({ view: fitView(boundsOf()) }) },
      { key: 'fit-selection', label: t.fitSelection, icon: 'maximize', hint: '⇧2', run: () => { const b = boundsOf(store.get().selection); if (b) store.set({ view: fitView(b, 4) }); } },
      { key: 'pixel-grid', label: t.togglePixelGrid, icon: 'grid', hint: '⇧\'', run: () => { const on = !store.get().pixelGrid; localStorage.setItem('nib-pixel-grid', on ? '1' : '0'); store.set({ pixelGrid: on }); } },
      { key: 'panel', label: t.togglePanel, icon: 'panelLeft', hint: '⌘\\', run: () => store.set({ leftOpen: !store.get().leftOpen }) },
      { key: 'activity', label: t.toggleActivity, icon: 'activity', run: () => toggleSide('activityOpen') },
      { key: 'agent', label: t.toggleAgent, icon: 'sparkles', run: () => toggleSide('agentOpen') },
      { key: 'browser', label: t.toggleBrowser, icon: 'globe', run: () => toggleSide('browserOpen') },
      { key: 'problems', label: t.problems, icon: 'scan', run: () => store.set({ leftOpen: true, leftTab: 'problems' }) },
      { key: 'lang', label: t.switchLanguage, icon: 'languages', run: () => { const lang = store.get().lang === 'en' ? 'zh' : 'en'; localStorage.setItem('nib-lang', lang); store.set({ lang }); } },
      // Saved commands: their message, sent to the agent with what is selected now.
      ...macros.map((m): Item => ({ key: `macro:${m.name}`, label: `${t.runCommand}: ${m.name}`, icon: 'command', run: () => {
        const { conn, selection } = store.get();
        if (!conn) return;
        store.set({ agentOpen: true, activityOpen: false, browserOpen: false });
        void loadAgent(conn.path).then(() => sendMessage(conn.path, m.text, selection)).catch((e: Error) => toast(e.message));
      } })),
    ];
  }, [t, macros]);

  const layers = useMemo<Item[]>(() => {
    if (!doc) return [];
    const out: Item[] = [];
    const visit = (n: Node, path: string) => {
      if (out.length >= MAX_LAYERS) return;
      const name = layerName(doc, n);
      if (n.name || !path) out.push({ key: n.id, label: name, hint: path, icon: typeIcon(n), run: () => { store.set({ selection: [n.id] }); const b = boundsOf([n.id]); if (b) store.set({ view: fitView(b, 2) }); } });
      for (const c of childrenOf(n) ?? []) visit(c, path ? `${path} / ${name}` : name);
    };
    for (const n of doc.data.children) visit(n, '');
    return out;
  }, [doc, version]);

  if (!open) return null;
  const q = query.trim().toLowerCase();
  const match = (i: Item) => !q || i.label.toLowerCase().includes(q) || (i.hint?.toLowerCase().includes(q) ?? false);
  const items = [...commands.filter(match), ...(q ? layers.filter(match) : layers.slice(0, 20))].slice(0, 60);
  const close = () => store.set({ paletteOpen: false });
  const run = (i: Item | undefined) => { if (!i) return; close(); i.run(); };
  return (
    <div className="palette-backdrop" onPointerDown={close}>
      <div className="palette" onPointerDown={(e) => e.stopPropagation()}>
        <div className="palette-input"><Icon name="search" /><input ref={input} value={query} placeholder={t.palette}
          onChange={(e) => { setQuery(e.target.value); setActive(0); }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter') run(items[active]);
          }} /></div>
        <div className="palette-list">
          {items.map((i, n) => (
            <button key={i.key} className={`palette-item${n === active ? ' active' : ''}`} onMouseEnter={() => setActive(n)} onClick={() => run(i)}>
              <Icon name={i.icon} size={14} /><span className="label">{i.label}</span>{i.hint && <span className="hint">{i.hint}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
