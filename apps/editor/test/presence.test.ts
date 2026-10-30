import { describe, expect, it } from 'vitest';
import type { Op } from '@nib/core';
import { FADE_MS, Presence } from '../src/canvas/presence.ts';

const insert = (id: string, parent: string | null = 'screen'): Op => ({ op: 'insert', parent, index: 0, node: { type: 'frame', id } as never });
const set = (id: string): Op => ({ op: 'set', id, props: { fill: '#000' } });

describe('presence', () => {
  it('hides inserted nodes until the change is laid out, then plays one beat per node', () => {
    const p = new Presence();
    const play = p.add('claude-code', [insert('a'), set('a'), insert('b', 'a'), set('x'), set('x'), set('y'), { op: 'remove', parent: 'screen', index: 2 }])!;
    expect(p.reveal.get('a')).toBe(Infinity);
    const track = p.agents.get('claude-code')!;
    expect(track.label).toBe('Claude Code');
    // The update to the node just inserted is part of its insert; repeated updates to one node are one beat.
    expect(track.beats.map((b) => [b.kind, b.id])).toEqual([['insert', 'a'], ['insert', 'b'], ['update', 'x'], ['update', 'y'], ['remove', 'screen']]);
    play(1000);
    const at = track.beats.map((b) => b.at);
    expect(at[0]).toBe(1000);
    expect(at).toEqual([...at].sort((x, y) => x - y));
    expect(at[at.length - 1] - at[0]).toBeLessThanOrEqual(2400);
    expect(p.reveal.get('b')).toBe(at[1]);
    expect(p.active(at[at.length - 1] + 1000)).toBe(true);
    p.prune(at[at.length - 1] + 60_000);
    expect(p.agents.size).toBe(0);
  });

  it('queues a change behind one still playing, at most a second behind', () => {
    const p = new Presence();
    p.add('codex', Array.from({ length: 20 }, (_, i) => insert(`n${i}`)))!(0);
    const last = p.agents.get('codex')!.beats.at(-1)!.at;
    p.add('codex', [insert('late')])!(100);
    expect(p.reveal.get('late')).toBe(1100);
    expect(last).toBeGreaterThan(1100);
    p.add('codex', [insert('later')])!(last + FADE_MS + 5000);
    expect(p.reveal.get('later')).toBe(last + FADE_MS + 5000);
  });
});
