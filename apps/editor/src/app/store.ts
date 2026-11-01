import { useSyncExternalStore } from 'react';
import type { PenDoc } from '@nib/core';
import type { Change, DocConnection } from './connection.ts';

import type { PenSession } from '../canvas/pen.tsx';
import type { GradientEdit } from '../canvas/GradientOverlay.tsx';
import type { CropEdit } from '../canvas/CropOverlay.tsx';
import { applyPrefs, readPrefs, writePrefs, type Prefs } from './prefs.ts';

export type Tool = 'move' | 'scale' | 'hand' | 'frame' | 'rectangle' | 'ellipse' | 'polygon' | 'pen' | 'pencil' | 'aipen' | 'text' | 'icon' | 'note';
export type LeftTab = 'layers' | 'slides' | 'components' | 'libraries' | 'variables' | 'strings' | 'history' | 'problems';
export type Lang = 'en' | 'zh';

/** Canvas position: a document point (x, y) appears on screen at (x * zoom + tx, y * zoom + ty). */
export interface View { tx: number; ty: number; zoom: number }

export interface EditorState {
  conn?: DocConnection;
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
  /** Nudge distances, zoom speed, theme, motion. */
  prefs: Prefs;
  /** A gradient fill whose handles are on the canvas. */
  gradientEdit?: GradientEdit;
  /** An image fill being cropped on the canvas. */
  crop?: CropEdit;
  /** Presenting: the slides in order, the one shown, and whether the screen is dipping to black between two. */
  present?: { ids: string[]; index: number; fading?: boolean; moving?: boolean };
  /** A path being drawn with the pen or having its points edited. */
  pen?: PenSession;
  /** The node whose text is being edited on the canvas. */
  editingText?: string;
  /** A box drawn with the AI pen, waiting for what to draw in it. */
  aiPen?: string;
  /** Show every frame in this language (a value of the Language theme axis), without changing the document. */
  previewLanguage?: string;
  lang: Lang;
  paletteOpen: boolean;
  toast?: { text: string; at: number };
  /** nib's website (no daemon): documents are kept in the browser. */
  web?: boolean;
  /** Where the website last saved the open document: only in this browser, or also to its file on disk. */
  webSave?: { where: 'browser' | 'disk'; file?: string; error?: string };
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
  prefs: readPrefs(),
});

/** Change preferences: stored for every nib window, shown at once. */
export function setPrefs(patch: Partial<Prefs>): void {
  const prefs = { ...store.get().prefs, ...patch };
  writePrefs(prefs);
  store.set({ prefs });
}

// The page follows the preferences, another window's changes to them, and the computer's light/dark and
// reduce-motion settings (for preferences that follow the system).
applyPrefs(store.get().prefs);
store.subscribe(() => applyPrefs(store.get().prefs));
window.addEventListener('storage', (e) => {
  if (e.key === 'nib-prefs') store.set({ prefs: readPrefs(e.newValue) });
  if (e.key === 'nib-pixel-grid') store.set({ pixelGrid: e.newValue !== '0' });
});
// A new prefs object, so everything that draws with them (the canvas) updates too.
for (const q of ['(prefers-color-scheme: light)', '(prefers-reduced-motion: reduce)']) matchMedia(q).addEventListener('change', () => store.set({ prefs: { ...store.get().prefs } }));

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
