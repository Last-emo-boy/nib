import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeProvider } from './claude.ts';
import { CodexProvider } from './codex.ts';
import { Keys } from './keys.ts';
import { CompatibleProvider, PRESETS } from './openai.ts';
import { systemPrompt } from './prompt.ts';
import { forgetSignIns } from './util.ts';
import type { PenDocument } from '@nib/format';
import type { AgentSession, AgentSettings, ChatItem, McpLaunch, Provider, ProviderInfo, RunEvent, SessionSummary, UsageTotals } from './types.ts';

/** nib's MCP server, which the agent's runtime starts to get nib's tools. */
const MCP_MAIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'mcp', 'src', 'main.ts');

/** What editors of a document hear about its agent sessions. */
export type AgentEvent = { t: 'agent'; session: SessionSummary; item?: ChatItem; removed?: boolean };

export interface DocumentAccess {
  read(doc: string): Promise<PenDocument>;
  restore(doc: string, data: PenDocument, label: string): Promise<void>;
}

export interface SendRequest {
  /** Continue this session; without it a new one starts. */
  session?: string;
  doc: string;
  provider: string;
  model?: string;
  text: string;
  selection?: string[];
  /** What the selected nodes are, for the agent (the daemon describes them). */
  context?: string;
}

const newId = () => `${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const summary = (s: AgentSession, running: boolean): SessionSummary => ({ id: s.id, title: s.title, doc: s.doc, provider: s.provider, model: s.model, created: s.created, updated: s.updated, running });

/**
 * nib's own agent: chat sessions about a document, each run by a provider (the person's Claude or Codex
 * subscription through their apps, or an API nib calls itself), with nib's MCP tools. Sessions are saved
 * as JSON files; editors of the document get every change to them as it happens.
 */
export class AgentService {
  readonly keys: Keys;
  private dir: string;
  private home: string;
  private providers: Provider[];
  private sessions = new Map<string, AgentSession>();
  private loaded: Promise<void> | undefined;
  private running = new Map<string, AbortController>();
  private listeners = new Map<string, Set<(e: AgentEvent) => void>>();
  private saving = new Map<string, ReturnType<typeof setTimeout>>();

  /** The document's state for the first message of a session (get_app_state's description of it). */
  private describe: ((doc: string) => Promise<string>) | undefined;
  /** The document's data now, and putting it back: checkpoints per message. */
  private document: DocumentAccess | undefined;

  constructor(opts: { home: string; providers?: Provider[]; describe?: (doc: string) => Promise<string>; document?: DocumentAccess }) {
    this.home = opts.home;
    this.describe = opts.describe;
    this.document = opts.document;
    this.dir = join(opts.home, 'agent', 'sessions');
    this.keys = new Keys(opts.home);
    this.providers = opts.providers ?? [new ClaudeProvider(), new CodexProvider(), ...PRESETS.map((p) => new CompatibleProvider(p, this.keys))];
  }

  /** Open Terminal running a provider's sign-in command (macOS); answers whether it could. */
  async signIn(id: string): Promise<boolean> {
    const info = await this.providers.find((p) => p.id === id)?.info();
    if (!info?.signIn || process.platform !== 'darwin') return false;
    const script = `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(info.signIn)}\nend tell`;
    await new Promise<void>((resolve, reject) => execFile('osascript', ['-e', script], (e) => (e ? reject(e) : resolve())));
    return true;
  }

  /** The providers, asking again whether their apps are signed in when `fresh`. */
  providerInfo(fresh = false): Promise<ProviderInfo[]> {
    if (fresh) forgetSignIns();
    return Promise.all(this.providers.map((p) => p.info().catch((e: Error) => ({ id: p.id, name: p.id, auth: 'none' as const, available: false, note: e.message, models: [], vision: false }))));
  }

  async list(doc?: string): Promise<SessionSummary[]> {
    await this.load();
    const path = doc ? resolvePath(doc) : undefined;
    return [...this.sessions.values()].filter((s) => !path || s.doc === path).sort((a, b) => b.updated - a.updated).map((s) => summary(s, this.running.has(s.id)));
  }

  async get(id: string): Promise<(AgentSession & { running: boolean }) | undefined> {
    await this.load();
    const s = this.sessions.get(id);
    return s && { ...s, transcript: undefined, running: this.running.has(id) };
  }

  /** Add the person's message to a session (a new one without `session`) and start the agent on it. */
  async send(req: SendRequest): Promise<SessionSummary> {
    await this.load();
    const provider = this.providers.find((p) => p.id === req.provider);
    if (!provider) throw new Error(`no agent provider "${req.provider}"`);
    let s = req.session ? this.sessions.get(req.session) : undefined;
    if (req.session && !s) throw new Error('no such session');
    if (s && this.running.has(s.id)) throw new Error('the agent is still working on the last message');
    const now = Date.now();
    if (!s || s.provider !== req.provider) {
      // Another provider cannot continue a conversation it did not have: start a new session.
      s = { id: newId(), title: req.text.replace(/\s+/g, ' ').slice(0, 60), doc: resolvePath(req.doc), provider: req.provider, model: req.model ?? '', created: now, updated: now, items: [] };
      this.sessions.set(s.id, s);
    }
    s.model = req.model ?? s.model;
    const first = !s.items.some((i) => i.kind === 'user');
    const user: ChatItem = { kind: 'user', id: newId(), at: now, text: req.text, ...(req.selection?.length ? { selection: req.selection } : {}) };
    const before = await this.document?.read(s.doc).catch(() => undefined);
    if (before) {
      await mkdir(join(this.checkpoints, s.id), { recursive: true });
      await writeFile(join(this.checkpoints, s.id, `${user.id}.json`), JSON.stringify(before));
      user.checkpoint = true;
    }
    this.push(s, user);
    const abort = new AbortController();
    this.running.set(s.id, abort);
    this.changed(s);
    void this.run(s, provider, req, first, abort, before);
    return summary(s, true);
  }

  /** Put the session's document back to how it was before message `itemId`. */
  async restore(id: string, itemId: string): Promise<void> {
    await this.load();
    const s = this.sessions.get(id);
    if (!s || !this.document) throw new Error('no such session');
    if (this.running.has(id)) throw new Error('stop the agent first');
    const data = JSON.parse(await readFile(join(this.checkpoints, id, `${itemId}.json`), 'utf8')) as PenDocument;
    await this.document.restore(s.doc, data, 'Restore before agent message');
  }

  private get checkpoints(): string {
    return join(this.home, 'agent', 'checkpoints');
  }

  async settings(): Promise<AgentSettings> {
    try {
      return JSON.parse(await readFile(join(this.home, 'agent', 'settings.json'), 'utf8')) as AgentSettings;
    } catch {
      return {};
    }
  }

  async saveSettings(next: AgentSettings): Promise<AgentSettings> {
    const clean: AgentSettings = {};
    if (Number.isFinite(next.tokensPerMessage) && next.tokensPerMessage! > 0) clean.tokensPerMessage = Math.round(next.tokensPerMessage!);
    if (Number.isFinite(next.usdPerMessage) && next.usdPerMessage! > 0) clean.usdPerMessage = next.usdPerMessage;
    await mkdir(join(this.home, 'agent'), { recursive: true });
    await writeFile(join(this.home, 'agent', 'settings.json'), `${JSON.stringify(clean, null, 2)}\n`);
    return clean;
  }

  /** Tokens and cost of every message since the start of this month, in all sessions. */
  async usage(): Promise<UsageTotals> {
    await this.load();
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const out: UsageTotals = { messages: 0, inputTokens: 0, cachedTokens: 0, outputTokens: 0, costUsd: 0 };
    for (const s of this.sessions.values()) {
      for (const i of s.items) {
        if (i.kind !== 'usage' || i.at < start.getTime()) continue;
        out.messages++;
        out.inputTokens += i.inputTokens ?? 0;
        out.cachedTokens += i.cachedTokens ?? 0;
        out.outputTokens += i.outputTokens ?? 0;
        out.costUsd += i.costUsd ?? 0;
      }
    }
    return out;
  }

  stop(id: string): void {
    this.running.get(id)?.abort();
  }

  async remove(id: string): Promise<void> {
    await this.load();
    const s = this.sessions.get(id);
    if (!s) return;
    this.stop(id);
    this.sessions.delete(id);
    await rm(join(this.dir, `${id}.json`), { force: true });
    await rm(join(this.checkpoints, id), { recursive: true, force: true });
    this.emit(s.doc, { t: 'agent', session: summary(s, false), removed: true });
  }

  subscribe(doc: string, fn: (e: AgentEvent) => void): () => void {
    const path = resolvePath(doc);
    let set = this.listeners.get(path);
    if (!set) this.listeners.set(path, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  /** The libraries a document imports, from its file. */
  private async imports(doc: string): Promise<Record<string, string>> {
    try {
      return (JSON.parse(await readFile(doc, 'utf8')) as { imports?: Record<string, string> }).imports ?? {};
    } catch {
      return {};
    }
  }

  /** How the agent's runtime starts nib's MCP server: this runtime, named after the provider. */
  private mcp(provider: string): McpLaunch {
    return {
      command: process.execPath,
      args: [MCP_MAIN],
      env: { NIB_HOME: this.home, NIB_AGENT: provider, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
    };
  }

  private async run(s: AgentSession, provider: Provider, req: SendRequest, first: boolean, abort: AbortController, before?: PenDocument): Promise<void> {
    const started = Date.now();
    let current: Extract<ChatItem, { kind: 'assistant' }> | undefined;
    let usage: { costUsd?: number; inputTokens?: number; cachedTokens?: number; outputTokens?: number } = {};
    const budget = await this.settings();
    let overBudget = false;
    const close = () => { if (current) { current.streaming = false; this.update(s, current); current = undefined; } };
    const emit = (e: RunEvent) => {
      switch (e.t) {
        case 'text':
          if (!current) this.push(s, (current = { kind: 'assistant', id: newId(), at: Date.now(), text: e.delta, streaming: true }));
          else { current.text += e.delta; this.update(s, current); }
          break;
        case 'text-end':
          if (!current) this.push(s, { kind: 'assistant', id: newId(), at: Date.now(), text: e.text });
          else { current.text = e.text; close(); }
          break;
        case 'tool':
          close();
          this.push(s, { kind: 'tool', id: e.id || newId(), at: Date.now(), name: e.name, status: 'running', ...(e.input === undefined ? {} : { input: JSON.stringify(e.input).slice(0, 4000) }) });
          break;
        case 'tool-done': {
          const item = s.items.find((i) => i.kind === 'tool' && i.id === e.id);
          if (item?.kind === 'tool') { item.status = e.ok ? 'done' : 'error'; item.output = e.output?.slice(0, 2000); this.update(s, item); }
          break;
        }
        case 'resume':
          s.resume = e.id;
          break;
        case 'warning':
          close();
          this.push(s, { kind: 'error', id: newId(), at: Date.now(), text: e.text });
          break;
        case 'spent':
          if (budget.tokensPerMessage && e.tokens > budget.tokensPerMessage && !abort.signal.aborted) {
            overBudget = true;
            abort.abort();
          }
          break;
        case 'usage': {
          const { t: _, ...counts } = e;
          usage = { ...usage, ...counts };
          break;
        }
      }
    };
    try {
      const info = await provider.info();
      // The first message carries the whole document's state; later ones only what is selected.
      const state = first && this.describe ? await this.describe(s.doc).catch(() => undefined) : undefined;
      const context = [state && `Document state:\n${state}`, req.context].filter(Boolean).join('\n\n');
      const prompt = context ? `${req.text}\n\n<context>\n${context}\n</context>` : req.text;
      // The system prompt stays the same through a session (provider caches key on it).
      const libraries = Object.keys(await this.imports(s.doc)).length > 0;
      if (abort.signal.aborted) return;
      const rules = before ? contextNotes(before) : [];
      await provider.run({ session: s, prompt, system: systemPrompt(s.doc, info.vision, libraries, rules), first, mcp: this.mcp(info.name), signal: abort.signal, emit, budgetUsd: budget.usdPerMessage });
    } catch (e) {
      close();
      if (!abort.signal.aborted) this.push(s, { kind: 'error', id: newId(), at: Date.now(), text: (e as Error).message || String(e) });

    } finally {
      close();
      // Tools still marked running when the run ends did not finish.
      for (const i of s.items) if (i.kind === 'tool' && i.status === 'running') { i.status = 'error'; i.output = abort.signal.aborted ? 'Stopped.' : i.output; this.update(s, i); }
      if (overBudget) this.push(s, { kind: 'error', id: newId(), at: Date.now(), text: `Stopped: this message used more than its budget of ${budget.tokensPerMessage} tokens.` });
      const after = before && (await this.document?.read(s.doc).catch(() => undefined));
      const changed = before && after ? changedFrames(before, after) : undefined;
      this.push(s, { kind: 'usage', id: newId(), at: Date.now(), durationMs: Date.now() - started, ...usage, ...(changed?.length ? { changed } : {}) });
      this.running.delete(s.id);
      this.changed(s);
      this.save(s, 0);
    }
  }

  private push(s: AgentSession, item: ChatItem): void {
    s.items.push(item);
    this.update(s, item);
  }

  private update(s: AgentSession, item: ChatItem): void {
    s.updated = Date.now();
    // A copy: the item keeps changing while the run goes on.
    this.emit(s.doc, { t: 'agent', session: summary(s, this.running.has(s.id)), item: { ...item } });
    this.save(s);
  }

  private changed(s: AgentSession): void {
    this.emit(s.doc, { t: 'agent', session: summary(s, this.running.has(s.id)) });
  }

  private emit(doc: string, e: AgentEvent): void {
    for (const fn of this.listeners.get(doc) ?? []) fn(e);
  }

  /** Write the session soon (streamed text changes many times a second). */
  private save(s: AgentSession, delay = 800): void {
    clearTimeout(this.saving.get(s.id));
    this.saving.set(s.id, setTimeout(() => {
      this.saving.delete(s.id);
      if (!this.sessions.has(s.id)) return;
      void mkdir(this.dir, { recursive: true }).then(() => writeFile(join(this.dir, `${s.id}.json`), JSON.stringify(s)));
    }, delay));
  }

  private load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const files = await readdir(this.dir).catch(() => [] as string[]);
      for (const f of files.filter((f) => f.endsWith('.json'))) {
        try {
          const s = JSON.parse(await readFile(join(this.dir, f), 'utf8')) as AgentSession;
          this.sessions.set(s.id, s);
        } catch {
          // A damaged session file: leave it, without the session.
        }
      }
    })());
  }
}

/** Names of the top-level frames that differ between two versions of a document (added, changed, removed). */
function changedFrames(before: PenDocument, after: PenDocument): string[] {
  const was = new Map(before.children.map((n) => [n.id, JSON.stringify(n)]));
  const is = new Map(after.children.map((n) => [n.id, JSON.stringify(n)]));
  const name = (n: { id: string; name?: string }) => n.name ?? n.id;
  const out: string[] = [];
  for (const n of after.children) if (was.get(n.id) !== is.get(n.id)) out.push(name(n));
  for (const n of before.children) if (!is.has(n.id)) out.push(name(n));
  return out.slice(0, 20);
}

/** The text of the document's context nodes: rules people leave for agents on the canvas. */
function contextNotes(doc: PenDocument): string[] {
  const out: string[] = [];
  const visit = (n: { type?: string; content?: unknown; enabled?: unknown; children?: unknown[] }) => {
    if (n.type === 'context' && n.enabled !== false && typeof n.content === 'string' && n.content.trim()) out.push(n.content.trim());
    for (const c of (n.children ?? []) as typeof n[]) visit(c);
  };
  for (const n of doc.children) visit(n as never);
  return out.slice(0, 20);
}
