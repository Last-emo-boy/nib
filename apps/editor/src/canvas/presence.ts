import type { Op } from '@nib/core';

/** How long a new node takes to fade in. */
export const FADE_MS = 340;
/** How long an outline flashes on a node an agent changed. */
export const FLASH_MS = 700;
/** How long a cursor takes to glide to its next target, at most. */
export const MOVE_MS = 280;
/** A change plays out over at most this long, one beat per node it touches. */
const SPAN_MS = 2400;
/** A cursor stays this long after its agent's last change, then fades. */
export const IDLE_MS = 6000;
const FADE_OUT_MS = 400;

/** One node an agent touched, and when its cursor gets there. */
export interface Beat {
  at: number;
  /** The node, or for a removal the parent it was removed from (undefined at the top level). */
  id: string | undefined;
  kind: 'insert' | 'update' | 'remove';
}

export interface AgentTrack {
  name: string;
  label: string;
  color: string;
  beats: Beat[];
}

const COLORS = ['#FF7A59', '#22C55E', '#A855F7', '#F59E0B', '#06B6D4', '#EC4899'];
const LABELS: Record<string, string> = {
  'claude-code': 'Claude Code', 'claude-ai': 'Claude', codex: 'Codex', 'codex-mcp-client': 'Codex', 'gemini-cli': 'Gemini',
  opencode: 'OpenCode', cursor: 'Cursor', 'cursor-vscode': 'Cursor', kiro: 'Kiro',
};

/** How an agent's client name reads in the editor. */
export const agentLabel = (name: string) => LABELS[name] ?? name;

function colorOf(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** The nodes a change touches, in order: each insert, each node updated (once in a row), each removal's parent. */
function beatsOf(ops: Op[]): Beat[] {
  const inserted = new Set<string>();
  const beats: Beat[] = [];
  const push = (id: string | undefined, kind: Beat['kind']) => {
    const last = beats[beats.length - 1];
    if (last && last.id === id && last.kind === kind) return;
    beats.push({ at: 0, id, kind });
  };
  for (const op of ops) {
    if (op.op === 'insert') { inserted.add(op.node.id); push(op.node.id, 'insert'); }
    else if (op.op === 'set') { if (!inserted.has(op.id)) push(op.id, 'update'); }
    else if (op.op === 'remove') push(op.parent ?? undefined, 'remove');
  }
  return beats;
}

/**
 * What agents are doing on the canvas: a timeline of beats per agent, which the cursor layer follows,
 * and when each node an agent inserted starts to fade in, which the canvas follows.
 */
export class Presence {
  /** Inserted node id -> when it starts fading in (performance.now() ms); hidden before. */
  readonly reveal = new Map<string, number>();
  readonly agents = new Map<string, AgentTrack>();
  private end = 0;
  private listeners = new Set<() => void>();

  /**
   * An agent's change, to be played: the nodes it inserts stay hidden until the returned function is
   * called (once they are laid out), which schedules its beats after any still playing, spread over at
   * most SPAN_MS.
   */
  add(agent: string, ops: Op[]): ((now: number) => void) | undefined {
    const beats = beatsOf(ops);
    if (!beats.length) return undefined;
    for (const b of beats) {
      b.at = Infinity;
      if (b.kind === 'insert' && b.id) this.reveal.set(b.id, Infinity);
    }
    let track = this.agents.get(agent);
    if (!track) this.agents.set(agent, (track = { name: agent, label: agentLabel(agent), color: colorOf(agent), beats: [] }));
    const now = performance.now();
    // Keep the beats still to play and the last one played (where the cursor is).
    const played = track.beats.filter((b) => b.at <= now);
    track.beats = [...played.slice(-1), ...track.beats.filter((b) => b.at > now), ...beats];
    return (now) => {
      // Fewer animations (nib's setting, or the computer's): changes show at once.
      const reduced = typeof document !== 'undefined' && document.documentElement.dataset.motion === 'reduced';
      // Queue behind what is playing, but never more than a second behind the document.
      const start = Math.max(now, Math.min(this.end, now + 1000));
      const step = Math.min(220, Math.max(12, SPAN_MS / beats.length));
      beats.forEach((b, i) => {
        b.at = reduced ? now : start + i * step;
        if (b.kind === 'insert' && b.id) { if (reduced) this.reveal.delete(b.id); else this.reveal.set(b.id, b.at); }
      });
      this.end = beats[beats.length - 1].at + step;
      for (const l of this.listeners) l();
    };
  }

  /** Whether anything is still moving or showing. */
  active(now: number): boolean {
    for (const t of this.agents.values()) if (visibleUntil(t) > now) return true;
    return false;
  }

  /** Forget agents whose cursor has faded out. */
  prune(now: number): void {
    for (const [name, t] of this.agents) if (visibleUntil(t) <= now) this.agents.delete(name);
    for (const [id, at] of this.reveal) if (at + FADE_MS < now - 1000) this.reveal.delete(id);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.reveal.clear();
    this.agents.clear();
    this.end = 0;
  }
}

const visibleUntil = (t: AgentTrack) => lastBeat(t) + IDLE_MS + FADE_OUT_MS;
/** When the agent's latest scheduled beat plays (a change still being laid out is not scheduled yet). */
const lastBeat = (t: AgentTrack) => { for (let i = t.beats.length - 1; i >= 0; i--) if (Number.isFinite(t.beats[i].at)) return t.beats[i].at; return t.beats.length ? Infinity : 0; };

/** A cursor's opacity: full while its agent works, fading out after it has been idle for IDLE_MS. */
export function cursorAlpha(t: AgentTrack, now: number): number {
  const last = lastBeat(t);
  return Math.max(0, Math.min(1, 1 - (now - last - IDLE_MS) / FADE_OUT_MS));
}

export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOut = (t: number) => 1 - (1 - t) ** 3;

export const presence = new Presence();
