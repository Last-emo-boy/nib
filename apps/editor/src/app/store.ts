import { useSyncExternalStore } from 'react';
import type { PenDoc } from '@nib/core';
import type { Change, Connection } from './connection.ts';

import type { PenSession } from '../canvas/pen.tsx';

export type Tool = 'move' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'polygon' | 'pen' | 'text' | 'icon' | 'note';
export type LeftTab = 'layers' | 'components' | 'libraries' | 'variables' | 'problems';
export type Lang = 'en' | 'zh';

/** Canvas position: a document point (x, y) appears on screen at (x * zoom + tx, y * zoom + ty). */
export interface View { tx: number; ty: number; zoom: number }

export interface EditorState {
  conn?: Connection;
  status: 'connecting' | 'open' | 'closed';
  doc?: PenDoc;
  /** Bumps on every document change; components that read `doc` select it. */
  version: number;
  /** Bumps when canvas scenes were rebuilt (new layout boxes). */
  layoutVersion: number;
  selection: string[];
  hover?: string;
  tool: Tool;
  view: View;
  leftTab: LeftTab;
  leftOpen: boolean;
  history: { undo: string[]; redo: string[] };
  /** Recent changes, newest last, for the activity feed. */
  changes: Change[];
  activityOpen: boolean;
  /** The chat with nib's agent. */
  agentOpen: boolean;
  /** The web page panel, for importing from sites. */
  browserOpen: boolean;
  /** Width of the agent's chat panel, and whether the canvas follows the agent's cursor. */
  agentWidth: number;
  followAgent: boolean;
  /** The 1px grid shown at high zoom. */
  pixelGrid: boolean;
  /** A path being drawn with the pen or having its points edited. */
  pen?: PenSession;
  /** The node whose text is being edited on the canvas. */
  editingText?: string;
  lang: Lang;
  paletteOpen: boolean;
  toast?: { text: string; at: number };
}

type Listener = () => void;

function createStore<S>(initial: S) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<S> | ((s: S) => Partial<S>)) {
      const p = typeof patch === 'function' ? (patch as (s: S) => Partial<S>)(state) : patch;
      state = { ...state, ...p };
      for (const l of listeners) l();
    },
    subscribe(l: Listener) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const savedLang = (localStorage.getItem('nib-lang') as Lang | null) ?? (navigator.language.startsWith('zh') ? 'zh' : 'en');

export const store = createStore<EditorState>({
  status: 'connecting',
  version: 0,
  layoutVersion: 0,
  selection: [],
  tool: 'move',
  view: { tx: 80, ty: 80, zoom: 1 },
  leftTab: 'layers',
  leftOpen: true,
  history: { undo: [], redo: [] },
  changes: [],
  activityOpen: false,
  agentOpen: localStorage.getItem('nib-agent-open') === '1',
  browserOpen: false,
  agentWidth: Number(localStorage.getItem('nib-agent-width')) || 384,
  followAgent: localStorage.getItem('nib-follow-agent') !== '0',
  lang: savedLang,
  paletteOpen: false,
  pixelGrid: localStorage.getItem('nib-pixel-grid') !== '0',
});

export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.get()));
}

/** The panels beside the properties share one place: opening one closes the others. */
export function toggleSide(panel: 'agentOpen' | 'activityOpen' | 'browserOpen'): void {
  const open = !store.get()[panel];
  store.set({ agentOpen: false, activityOpen: false, browserOpen: false, [panel]: open });
}

export function toast(text: string): void {
  store.set({ toast: { text, at: Date.now() } });
}
