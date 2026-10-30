import { useEffect, useReducer, type CSSProperties } from 'react';
import type { Box } from '@nib/layout';
import { useEditor } from '../app/store.ts';
import { canvas } from './Canvas.tsx';
import { cursorAlpha, ease, FLASH_MS, MOVE_MS, presence, type AgentTrack, type Beat } from './presence.ts';

interface Point { x: number; y: number }

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));
const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Where a beat points (just inside its node's top-left corner), once the node has been laid out. */
function target(b: Beat): { p: Point; box: Box } | undefined {
  const box = b.id ? canvas.cache?.box(b.id) : undefined;
  if (!box) return undefined;
  return { p: { x: box.x + Math.min(box.width / 2, 24), y: box.y + Math.min(box.height / 2, 16) }, box };
}

/** The cursor's position: at the last beat reached, gliding to the next one in the MOVE_MS before it. */
function cursorAt(t: AgentTrack, now: number): Point | undefined {
  const pts = t.beats.flatMap((b) => { const x = Number.isFinite(b.at) ? target(b) : undefined; return x ? [{ at: b.at, p: x.p }] : []; });
  if (!pts.length) return undefined;
  let i = -1;
  for (let k = 0; k < pts.length; k++) if (pts[k].at <= now) i = k;
  if (i === -1) {
    // Arriving: glide in towards the first target.
    const first = pts[0];
    return lerp({ x: first.p.x - 80, y: first.p.y - 50 }, first.p, ease(clamp01(1 - (first.at - now) / MOVE_MS)));
  }
  if (i === pts.length - 1) return pts[i].p;
  const a = pts[i], b = pts[i + 1];
  const start = Math.max(a.at, b.at - MOVE_MS);
  return lerp(a.p, b.p, ease(clamp01((now - start) / Math.max(1, b.at - start))));
}

/**
 * Agents at work on the canvas: each one's cursor, with its name, moves to every node it inserts or
 * changes, and those nodes flash an outline in the agent's color.
 */
export function AgentCursors() {
  const view = useEditor((s) => s.view);
  const [, tick] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    let frame = 0;
    const loop = () => {
      frame = 0;
      const now = performance.now();
      presence.prune(now);
      tick();
      if (presence.active(now)) frame = requestAnimationFrame(loop);
    };
    const off = presence.onChange(() => { if (!frame) frame = requestAnimationFrame(loop); });
    return () => { off(); cancelAnimationFrame(frame); };
  }, []);

  const now = performance.now();
  const screen = (p: Point) => ({ x: p.x * view.zoom + view.tx, y: p.y * view.zoom + view.ty });
  const tracks = [...presence.agents.values()];
  return (
    <div className="agents">
      {tracks.flatMap((t) => t.beats.flatMap((b, i) => {
        const age = now - b.at;
        if (age < 0 || age > FLASH_MS) return [];
        const x = target(b);
        if (!x) return [];
        const s = screen(x.box);
        const style = { left: s.x, top: s.y, width: x.box.width * view.zoom, height: x.box.height * view.zoom, opacity: 1 - age / FLASH_MS, '--agent': t.color } as CSSProperties;
        return [<div key={`${t.name}-${i}-${b.at}`} className={`agent-flash ${b.kind}`} style={style} />];
      }))}
      {tracks.map((t) => {
        const p = cursorAt(t, now);
        if (!p) return null;
        const s = screen(p);
        const style = { transform: `translate(${s.x}px, ${s.y}px)`, opacity: cursorAlpha(t, now), '--agent': t.color } as CSSProperties;
        return (
          <div key={t.name} className="agent-cursor" style={style}>
            <svg width="20" height="22" viewBox="0 0 20 22"><path d="M2 1.5 L2 18 L6.6 13.6 L9.8 20.6 L12.9 19.2 L9.8 12.4 L16.2 12.4 Z" /></svg>
            <span className="agent-name">{t.label}</span>
          </div>
        );
      })}
    </div>
  );
}
