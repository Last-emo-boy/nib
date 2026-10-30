import { applyOp, PenDoc, type Op } from '@nib/core';
import type { PenDocument } from '@nib/format';

declare const __NIB_DEV_TOKEN__: string;

export type Source = { kind: 'user'; client?: string } | { kind: 'agent'; name: string };

/** A change as editors see it: who made it, what it was called, and the ops that made it. */
export interface Change {
  version: number;
  ops: Op[];
  source: Source;
  label: string;
  at: number;
  /** True when this editor made it. */
  mine: boolean;
}

export type ConnectionEvent =
  | { t: 'doc'; doc: PenDoc; version: number }
  | { t: 'change'; change: Change }
  | { t: 'history'; undo: string[]; redo: string[] }
  /** An image changed without its url changing (a browser node's page snapshot). */
  | { t: 'asset'; url: string }
  | { t: 'status'; status: 'connecting' | 'open' | 'closed'; error?: string };

/** The token comes in the link's hash (`#t=...`), which never reaches a server, and is kept for the tab. */
export function token(): string {
  const hash = new URLSearchParams(location.hash.slice(1));
  const t = hash.get('t');
  if (t) sessionStorage.setItem('nib-token', t);
  return t ?? sessionStorage.getItem('nib-token') ?? __NIB_DEV_TOKEN__;
}

export function fileFromUrl(): string | undefined {
  const hash = new URLSearchParams(location.hash.slice(1));
  return hash.get('file') ?? sessionStorage.getItem('nib-file') ?? undefined;
}

export function authHeaders(): HeadersInit {
  return { authorization: `Bearer ${token()}` };
}

/**
 * The editor's link to the daemon for one document. The daemon owns the document: edits are sent as ops
 * and applied here only when the daemon sends them back, in order, with everyone else's. So this copy
 * always matches the file.
 */
export class Connection {
  readonly path: string;
  doc: PenDoc | undefined;
  version = 0;
  client: string | undefined;
  private ws: WebSocket | undefined;
  private listeners = new Set<(e: ConnectionEvent) => void>();
  private seq = 0;
  private pending = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  private retry = 0;
  private closed = false;

  constructor(path: string) {
    this.path = path;
    this.connect();
  }

  on(listener: (e: ConnectionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Send ops as one undoable change; resolves when the daemon has applied it. */
  edit(ops: Op[], label: string): Promise<void> {
    if (!ops.length) return Promise.resolve();
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(seq, { resolve, reject });
      this.send({ t: 'edit', path: this.path, seq, ops, label });
    });
  }

  undo(): void {
    this.send({ t: 'undo', path: this.path });
  }

  redo(): void {
    this.send({ t: 'redo', path: this.path });
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }

  private emit(e: ConnectionEvent): void {
    for (const l of this.listeners) l(e);
  }

  private send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private connect(): void {
    this.emit({ t: 'status', status: 'connecting' });
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?t=${encodeURIComponent(token())}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.emit({ t: 'status', status: 'open' });
      this.send({ t: 'open', path: this.path });
    };
    ws.onmessage = (e) => this.receive(JSON.parse(String(e.data)));
    ws.onclose = () => {
      for (const p of this.pending.values()) p.reject(new Error('disconnected'));
      this.pending.clear();
      this.emit({ t: 'status', status: 'closed' });
      if (this.closed) return;
      // The daemon restarted or went idle: reconnect and reload the document.
      setTimeout(() => this.connect(), Math.min(5000, 300 * 2 ** this.retry++));
    };
  }

  private receive(m: Record<string, any>): void {
    switch (m.t) {
      case 'doc':
      case 'reload':
        if (m.client) this.client = m.client;
        this.doc = withImports(new PenDoc(m.data as PenDocument), m.imports);
        this.version = m.version;
        this.emit({ t: 'doc', doc: this.doc, version: m.version });
        if (m.undo) this.emit({ t: 'history', undo: m.undo, redo: m.redo });
        break;
      case 'ops': {
        if (!this.doc) return;
        for (const op of m.ops as Op[]) applyOp(this.doc, op);
        this.version = m.version;
        const source = m.source as Source;
        this.emit({ t: 'change', change: { version: m.version, ops: m.ops, source, label: m.label, at: Date.now(), mine: source.kind === 'user' && source.client === this.client } });
        break;
      }
      case 'history':
        this.emit({ t: 'history', undo: m.undo, redo: m.redo });
        break;
      case 'asset':
        this.emit({ t: 'asset', url: m.url });
        break;
      case 'ack': {
        const p = this.pending.get(m.seq);
        this.pending.delete(m.seq);
        if (m.ok) p?.resolve();
        else p?.reject(new Error(m.error));
        break;
      }
      case 'error':
        console.warn('nib daemon:', m.error);
        break;
    }
  }
}

type ImportTree = Record<string, { data: PenDocument; imports: ImportTree }>;

/** The documents `doc` imports (libraries), as the daemon sends them, so their components and variables resolve. */
function withImports(doc: PenDoc, tree: ImportTree | undefined): PenDoc {
  for (const [alias, sub] of Object.entries(tree ?? {})) doc.imports.set(alias, withImports(new PenDoc(sub.data), sub.imports));
  return doc;
}
