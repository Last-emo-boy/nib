import { useSyncExternalStore } from 'react';
import { authHeaders } from './connection.ts';
import { post } from './libraries.ts';

// The daemon's agent types, as the editor receives them (see packages/daemon/src/agent/types.ts).
export type ChatItem =
  | { kind: 'user'; id: string; at: number; text: string; selection?: string[]; checkpoint?: boolean; attachments?: { name: string; type: string; file: string }[] }
  | { kind: 'assistant'; id: string; at: number; text: string; streaming?: boolean }
  | { kind: 'tool'; id: string; at: number; name: string; input?: string; status: 'running' | 'done' | 'error'; output?: string }
  | { kind: 'error'; id: string; at: number; text: string }
  | { kind: 'usage'; id: string; at: number; costUsd?: number; inputTokens?: number; cachedTokens?: number; outputTokens?: number; durationMs: number; changed?: string[] };

export interface VariantInfo { group: string; of: string; frame: string; index: number; count: number }
export interface SessionSummary { id: string; title: string; doc: string; provider: string; model: string; created: number; updated: number; running: boolean; variant?: VariantInfo }
export interface ModelChoice { id: string; label: string; vision?: boolean }
export interface ProviderInfo { id: string; name: string; auth: 'app' | 'key' | 'none'; available: boolean; note?: string; models: ModelChoice[]; vision: boolean; signIn?: string }
export type AgentEvent = { t: 'agent'; session: SessionSummary; item?: ChatItem; removed?: boolean };

interface AgentState {
  doc?: string;
  sessions: SessionSummary[];
  /** Items of the sessions loaded so far. */
  items: Record<string, ChatItem[]>;
  /** The session the panel shows; none for a new chat. */
  current?: string;
  providers: ProviderInfo[];
  provider: string;
  model: string;
}

let state: AgentState = {
  sessions: [], items: {}, providers: [],
  provider: localStorage.getItem('nib-agent-provider') ?? 'claude',
  model: localStorage.getItem('nib-agent-model') ?? '',
};
const listeners = new Set<() => void>();
const set = (patch: Partial<AgentState>) => { state = { ...state, ...patch }; for (const l of listeners) l(); };

export const agent = {
  get: () => state,
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
};

export function useAgent<T>(select: (s: AgentState) => T): T {
  return useSyncExternalStore(agent.subscribe, () => select(state));
}

const get = async <T>(path: string): Promise<T> => (await fetch(path, { headers: authHeaders() })).json() as Promise<T>;

/** Load the providers and this document's sessions (the newest one shown). */
export async function loadAgent(doc: string): Promise<void> {
  if (state.doc !== doc) set({ doc, sessions: [], items: {}, current: undefined });
  const [{ providers }, { sessions }] = await Promise.all([
    get<{ providers: ProviderInfo[] }>('/api/agent/providers'),
    get<{ sessions: SessionSummary[] }>(`/api/agent/sessions?${new URLSearchParams({ doc })}`),
  ]);
  set({ providers, sessions });
  // Keep a provider that can run; else the first that can.
  if (!providers.some((p) => p.id === state.provider && p.available)) {
    const first = providers.find((p) => p.available);
    if (first) choose(first.id, '');
  }
  if (state.current === undefined && sessions[0]) await openSession(sessions[0].id);
}

/** `fresh`: ask the apps again whether they are signed in. */
export async function refreshProviders(fresh = false): Promise<void> {
  set({ providers: (await get<{ providers: ProviderInfo[] }>(`/api/agent/providers${fresh ? '?fresh=1' : ''}`)).providers });
}

/** Open Terminal with the provider's sign-in command; false when this computer cannot. */
export async function signIn(provider: string): Promise<boolean> {
  return (await post<{ ok: boolean }>('/api/agent/signin', { provider })).ok;
}

export async function openSession(id: string | undefined): Promise<void> {
  set({ current: id });
  if (!id || state.items[id]) return;
  const r = await get<{ session?: { items: ChatItem[] } }>(`/api/agent/session?${new URLSearchParams({ id })}`);
  if (r.session) set({ items: { ...state.items, [id]: r.session.items } });
}

export function choose(provider: string, model: string): void {
  localStorage.setItem('nib-agent-provider', provider);
  localStorage.setItem('nib-agent-model', model);
  set({ provider, model });
}

/** Send a message to the current session (a new one when there is none, or when the provider changed). */
/** A file to send with a message: base64 bytes. */
export interface Outgoing { name: string; type: string; data: string }

export async function sendMessage(doc: string, text: string, selection: string[], attachments: Outgoing[] = []): Promise<void> {
  const current = state.sessions.find((s) => s.id === state.current);
  const same = current && current.provider === state.provider;
  const { session } = await post<{ session: SessionSummary }>('/api/agent/send', {
    doc, text, selection, provider: state.provider, model: state.model, ...(same ? { session: current.id } : {}), ...(attachments.length ? { attachments } : {}),
  });
  if (!state.items[session.id]) set({ items: { ...state.items, [session.id]: [] } });
  upsert(session);
  set({ current: session.id });
}

/** Several agents at once, each on its own copy of top-level frame `frame`; the first variant is shown. */
export async function sendVariants(doc: string, frame: string, count: number, text: string, attachments: Outgoing[] = []): Promise<void> {
  const r = await post<{ sessions: SessionSummary[] }>('/api/agent/variants', {
    doc, frame, count, text, provider: state.provider, model: state.model, ...(attachments.length ? { attachments } : {}),
  });
  const items = { ...state.items };
  for (const s of r.sessions) { items[s.id] ??= []; upsert(s); }
  set({ items, current: r.sessions[0]?.id });
}

/** Tablet and phone versions of top-level frame `frame`, each adapted by its own agent; the first is shown. */
export async function sendResponsive(doc: string, frame: string, text: string): Promise<string[]> {
  const r = await post<{ frames: { id: string }[]; sessions: SessionSummary[] }>('/api/agent/responsive', { doc, frame, text, provider: state.provider, model: state.model });
  const items = { ...state.items };
  for (const s of r.sessions) { items[s.id] ??= []; upsert(s); }
  set({ items, current: r.sessions[0]?.id });
  return r.frames.map((f) => f.id);
}

/** Put the design back to how it was before a message of the current session. */
export async function restoreBefore(item: string): Promise<void> {
  if (state.current) await post('/api/agent/restore', { session: state.current, item });
}

export function stopSession(id: string): void {
  void post('/api/agent/stop', { id });
}

export async function deleteSession(id: string): Promise<void> {
  await post('/api/agent/delete', { id });
}

export async function saveKey(provider: string, key: string): Promise<void> {
  await post('/api/agent/key', { provider, key });
  await refreshProviders();
}

/** A change the daemon sent: a session's summary, and the item that changed. */
export function receive(e: AgentEvent): void {
  if (e.removed) {
    const items = { ...state.items };
    delete items[e.session.id];
    set({ sessions: state.sessions.filter((s) => s.id !== e.session.id), items, current: state.current === e.session.id ? undefined : state.current });
    return;
  }
  upsert(e.session);
  if (e.item) {
    const list = state.items[e.session.id] ?? [];
    const i = list.findIndex((x) => x.id === e.item!.id);
    const next = i < 0 ? [...list, e.item] : list.map((x, j) => (j === i ? e.item! : x));
    set({ items: { ...state.items, [e.session.id]: next } });
  }
}

function upsert(s: SessionSummary): void {
  const rest = state.sessions.filter((x) => x.id !== s.id);
  set({ sessions: [s, ...rest].sort((a, b) => b.updated - a.updated) });
}
