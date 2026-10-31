import { useState } from 'react';
import { loadAgent, sendMessage } from '../app/agent.ts';
import { useT } from '../app/i18n.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { canvas } from './Canvas.tsx';

/**
 * The AI pen: drag a box on the canvas, say what to draw in it, and the agent draws it there as editable
 * paths (SVG through InsertSvg), in the style chosen: a line icon, a line drawing, a flat illustration, a logo.
 */

export type PenStyle = 'icon' | 'line' | 'flat' | 'logo';
export const PEN_STYLES: PenStyle[] = ['flat', 'line', 'icon', 'logo'];

export function AiPenPrompt({ id }: { id: string }) {
  const t = useT();
  const view = useEditor((s) => s.view);
  const conn = useEditor((s) => s.conn);
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.layoutVersion);
  const [text, setText] = useState('');
  const [style, setStyle] = useState<PenStyle>(() => (localStorage.getItem('nib-ai-pen-style') as PenStyle | null) ?? 'flat');
  const b = canvas.cache?.bounds(id);
  if (!b || !doc?.has(id) || !conn) return null;
  const close = () => store.set({ aiPen: undefined });
  const send = async () => {
    const what = text.trim();
    if (!what) return;
    localStorage.setItem('nib-ai-pen-style', style);
    const node = doc.get(id) as { name?: string; width?: unknown; height?: unknown };
    const w = Math.round(typeof node.width === 'number' ? node.width : b.width), h = Math.round(typeof node.height === 'number' ? node.height : b.height);
    store.set({ aiPen: undefined, selection: [id], agentOpen: true, activityOpen: false, browserOpen: false });
    try {
      await loadAgent(conn.path);
      await sendMessage(conn.path, t.aiPenPrompt(what, t.penStyles[style].prompt, String(node.name ?? 'Drawing'), id, w, h), [id]);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <div className="aipen" style={{ left: b.x * view.zoom + view.tx, top: (b.y + b.height) * view.zoom + view.ty + 8 }} onPointerDown={(e) => e.stopPropagation()}>
      <input autoFocus value={text} placeholder={t.aiPenPlaceholder} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && !e.nativeEvent.isComposing) void send(); if (e.key === 'Escape') close(); }} />
      <select value={style} onChange={(e) => setStyle(e.target.value as PenStyle)}>
        {PEN_STYLES.map((s) => <option key={s} value={s}>{t.penStyles[s].label}</option>)}
      </select>
      <button className="primary" disabled={!text.trim()} onClick={() => void send()}>{t.draw}</button>
    </div>
  );
}
