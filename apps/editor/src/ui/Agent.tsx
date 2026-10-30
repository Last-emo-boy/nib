import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { choose, deleteSession, loadAgent, openSession, refreshProviders, restoreBefore, saveKey, sendMessage, signIn, stopSession, useAgent, type ChatItem, type ProviderInfo } from '../app/agent.ts';
import { authHeaders } from '../app/connection.ts';
import { useT } from '../app/i18n.ts';
import { post } from '../app/libraries.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { insertNode } from '../app/actions.ts';
import { boundsOf, fitView } from '../canvas/Canvas.tsx';
import { Icon } from './Icon.tsx';

/** The chat with nib's agent about this document, beside the canvas. */
export function AgentPanel() {
  const open = useEditor((s) => s.agentOpen);
  const conn = useEditor((s) => s.conn);
  useEffect(() => { localStorage.setItem('nib-agent-open', open ? '1' : '0'); }, [open]);
  useEffect(() => { if (open && conn) loadAgent(conn.path).catch((e: Error) => toast(e.message)); }, [open, conn]);
  const width = useEditor((s) => s.agentWidth);
  if (!open || !conn) return null;
  return (
    <div className="panel agent-panel" style={{ width }}>
      <Resizer />
      <Header />
      <Chat />
      <Composer doc={conn.path} />
      <UsageFooter />
    </div>
  );
}

/** Drag the panel's left edge to make the chat wider or narrower. */
function Resizer() {
  return (
    <div className="agent-resize" onPointerDown={(e) => {
      const start = e.clientX, from = store.get().agentWidth;
      const move = (ev: PointerEvent) => store.set({ agentWidth: Math.round(Math.min(720, Math.max(300, from + start - ev.clientX))) });
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); localStorage.setItem('nib-agent-width', String(store.get().agentWidth)); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }} />
  );
}

function Header() {
  const t = useT();
  const follow = useEditor((s) => s.followAgent);
  const sessions = useAgent((s) => s.sessions);
  const current = useAgent((s) => s.current);
  return (
    <div className="agent-head">
      <Icon name="sparkles" size={14} />
      <select className="agent-sessions" value={current ?? ''} onChange={(e) => void openSession(e.target.value || undefined)}>
        <option value="">{t.newChat}</option>
        {sessions.map((s) => <option key={s.id} value={s.id}>{s.running ? '● ' : ''}{s.title || t.untitledChat}</option>)}
      </select>
      <button className="icon-button" title={t.rulesHint} onClick={() => void openRules(t.rulesPlaceholder)}><Icon name="note" size={14} /></button>
      <button className={`icon-button${follow ? ' on' : ''}`} title={follow ? t.followOn : t.followOff} onClick={() => { localStorage.setItem('nib-follow-agent', follow ? '0' : '1'); store.set({ followAgent: !follow }); }}><Icon name={follow ? 'eye' : 'eyeOff'} size={14} /></button>
      <button className="icon-button" title={t.newChat} onClick={() => void openSession(undefined)}><Icon name="plus" size={14} /></button>
      {current && <button className="icon-button" title={t.deleteChat} onClick={() => { if (confirm(t.deleteChatConfirm)) void deleteSession(current); }}><Icon name="trash" size={13} /></button>}
      <button className="icon-button" title={t.close} onClick={() => store.set({ agentOpen: false })}><Icon name="x" size={14} /></button>
    </div>
  );
}

function Chat() {
  const t = useT();
  const current = useAgent((s) => s.current);
  const items = useAgent((s) => (s.current ? s.items[s.current] : undefined)) ?? [];
  const running = useAgent((s) => s.sessions.find((x) => x.id === s.current)?.running ?? false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  // Follow the conversation while it grows, unless the person scrolled up to read.
  useLayoutEffect(() => { const el = box.current; if (el && stick.current) el.scrollTop = el.scrollHeight; }, [items, running]);
  if (!current || !items.length) return <div className="agent-chat"><Suggestions /></div>;
  const last = items[items.length - 1];
  const working = running && !(last.kind === 'assistant' && last.streaming) && !(last.kind === 'tool' && last.status === 'running');
  return (
    <div className="agent-chat" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
      {items.map((i) => <Item key={i.id} item={i} />)}
      {working && <div className="agent-working"><span className="dots"><i /><i /><i /></span>{t.agentWorking}</div>}
    </div>
  );
}

function Suggestions() {
  const t = useT();
  const doc = useEditor((s) => s.doc);
  const library = Object.keys(doc?.data.imports ?? {})[0];
  const ideas = library ? t.agentIdeasLibrary : t.agentIdeas;
  return (
    <div className="agent-empty">
      <div className="agent-empty-title">{t.agentHello}</div>
      <p>{library ? t.agentHelloLibrary(library) : t.agentHelloPlain}</p>
      <div className="agent-ideas">
        {ideas.map((idea) => <button key={idea} onClick={() => window.dispatchEvent(new CustomEvent('nib-agent-prompt', { detail: idea }))}>{idea}</button>)}
      </div>
    </div>
  );
}

function Item({ item }: { item: ChatItem }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  switch (item.kind) {
    case 'user':
      return (
        <div className="agent-user">
          <div className="bubble">{item.text}</div>
          <div className="agent-user-row">
            {item.selection?.length ? <button className="agent-sel" onClick={() => select(item.selection!)}><Icon name="diamond" size={11} />{t.selectedCount(item.selection.length)}</button> : null}
            {item.checkpoint && <button className="agent-restore" title={t.restoreHint} onClick={() => { if (confirm(t.restoreConfirm)) restoreBefore(item.id).catch((e: Error) => toast(e.message)); }}><Icon name="undo" size={11} />{t.restore}</button>}
          </div>
        </div>
      );
    case 'assistant':
      return <div className={`agent-text${item.streaming ? ' streaming' : ''}`}><RichText text={item.text} /></div>;
    case 'tool': {
      const detail = toolDetail(item.name, item.input);
      return (
        <div className={`agent-tool ${item.status}`}>
          <button className="agent-tool-row" onClick={() => setOpen(!open)}>
            <span className="agent-tool-icon">{item.status === 'running' ? <span className="spinner" /> : <Icon name={item.status === 'done' ? 'check' : 'x'} size={12} />}</span>
            <span className="agent-tool-name">{t.toolNames[item.name as keyof typeof t.toolNames] ?? item.name}</span>
            {detail && <span className="agent-tool-detail">{detail}</span>}
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={12} />
          </button>
          {open && (
            <div className="agent-tool-body">
              {item.input && <pre>{readableInput(item.input)}</pre>}
              {item.output && <pre className="out">{item.output}</pre>}
            </div>
          )}
        </div>
      );
    }
    case 'error':
      return <div className="agent-error">{item.text}{/not logged in|\/login/i.test(item.text) && <div className="hint">{t.claudeSignIn}</div>}</div>;
    case 'usage':
      return (
        <div className="agent-usage">
          {item.changed?.length ? <button className="agent-changed" onClick={() => selectFrames(item.changed!)}>{t.changedFrames(item.changed)}</button> : null}
          <span>{usageLine(item)}</span>
        </div>
      );
  }
}

function usageLine(u: Extract<ChatItem, { kind: 'usage' }>): string {
  const n = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 0 : 1)}k` : String(x));
  const cached = u.inputTokens && u.cachedTokens ? ` (${Math.round((u.cachedTokens / u.inputTokens) * 100)}% cached)` : '';
  return [`${(u.durationMs / 1000).toFixed(1)}s`, u.inputTokens ? `${n(u.inputTokens)} in${cached}` : '', u.outputTokens ? `${n(u.outputTokens)} out` : '', u.costUsd ? `$${u.costUsd.toFixed(3)}` : ''].filter(Boolean).join(' · ');
}

/** A short hint of what a tool call did: the guide file, the page, or the first line of a snippet. */
function toolDetail(name: string, input?: string): string {
  try {
    const args = input ? (JSON.parse(input) as Record<string, unknown>) : {};
    if (name === 'read_skill') return typeof args.path === 'string' ? args.path : 'SKILL.md';
    if (name === 'get_style') return typeof args.name === 'string' ? args.name : '';
    if (name === 'browser') return [args.action, args.url].filter(Boolean).join(' ');
    if (name === 'execute') {
      if (typeof args.editId === 'string') return '…';
      const line = String(args.input ?? '').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('//'));
      return line?.slice(0, 80) ?? '';
    }
  } catch {
    // Truncated input: no detail.
  }
  return '';
}

/** Tool input for reading: an execute snippet as code, anything else as JSON. */
function readableInput(input: string): string {
  try {
    const args = JSON.parse(input) as Record<string, unknown>;
    if (typeof args.input === 'string') return args.input;
    return JSON.stringify(args, null, 2);
  } catch {
    return input;
  }
}

/**
 * The document's rules for agents live in context nodes: select them, or make one beside the design
 * when there is none.
 */
async function openRules(placeholder: string): Promise<void> {
  const doc = store.get().doc;
  if (!doc) return;
  const found: string[] = [];
  const visit = (n: { id: string; type: string; children?: unknown[] }) => { if (n.type === 'context') found.push(n.id); for (const c of (n.children ?? []) as typeof n[]) visit(c); };
  doc.data.children.forEach((n) => visit(n as never));
  if (found.length) { select(found); return; }
  const b = boundsOf();
  const id = await insertNode(null, { type: 'context', name: 'Agent rules', x: b ? Math.round(b.x) : 0, y: b ? Math.round(b.y - 260) : 0, width: 420, height: 200, content: placeholder }, 'Add agent rules');
  if (id) select([id]);
}

/** Select the top-level frames with these names (what a run changed). */
function selectFrames(names: string[]): void {
  const doc = store.get().doc;
  select(doc?.data.children.filter((n) => names.includes(n.name ?? n.id)).map((n) => n.id) ?? []);
}

function select(ids: string[]): void {
  const doc = store.get().doc;
  const live = ids.filter((id) => doc?.has(id));
  if (!live.length) return;
  store.set({ selection: live });
  const b = boundsOf(live);
  if (b) store.set({ view: fitView(b, 2) });
}

/** Paragraphs, lists, code blocks, **bold** and `code`; node ids in code select the node. */
function RichText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let para: string[] = [], list: string[] = [], code: string[] | undefined;
  const flush = () => {
    if (para.length) out.push(<p key={out.length}>{para.map((l, i) => <Fragment key={i}>{i > 0 && <br />}{inline(l)}</Fragment>)}</p>);
    if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    para = []; list = [];
  };
  for (const line of text.split('\n')) {
    if (line.trim().startsWith('```')) {
      if (code) { out.push(<pre key={out.length}>{code.join('\n')}</pre>); code = undefined; } else { flush(); code = []; }
      continue;
    }
    if (code) { code.push(line); continue; }
    const bullet = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet) { if (para.length) { const keep = list; list = []; flush(); list = keep; } list.push(bullet[1]); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list.length) flush();
    para.push(line.replace(/^#{1,6}\s+/, ''));
  }
  if (code) out.push(<pre key={out.length}>{code.join('\n')}</pre>);
  flush();
  return <>{out}</>;
}

function inline(s: string): ReactNode[] {
  return s.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      const id = part.slice(1, -1);
      return store.get().doc?.has(id) ? <code key={i} className="node-link" onClick={() => select([id])}>{id}</code> : <code key={i}>{id}</code>;
    }
    return part;
  });
}

function Composer({ doc }: { doc: string }) {
  const t = useT();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const selection = useEditor((s) => s.selection);
  const providers = useAgent((s) => s.providers);
  const provider = useAgent((s) => s.provider);
  const model = useAgent((s) => s.model);
  const running = useAgent((s) => s.sessions.find((x) => x.id === s.current)?.running ?? false);
  const current = useAgent((s) => s.current);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const fill = (e: Event) => { setText((e as CustomEvent<string>).detail); input.current?.focus(); };
    window.addEventListener('nib-agent-prompt', fill);
    return () => window.removeEventListener('nib-agent-prompt', fill);
  }, []);
  const info = providers.find((p) => p.id === provider);
  const send = async () => {
    const message = text.trim();
    if (!message || running || sending || !info?.available) return;
    setSending(true);
    try {
      await sendMessage(doc, message, selection);
      setText('');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="agent-composer">
      {info && !info.available && <ProviderSetup info={info} />}
      <textarea ref={input} value={text} rows={3} placeholder={t.askAgent} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
        }} />
      <div className="agent-bar">
        <ModelPicker />
        {selection.length > 0 && <span className="agent-sel static" title={t.selectionContext}><Icon name="diamond" size={11} />{t.selectedCount(selection.length)}</span>}
        <span className="grow" />
        {running && current
          ? <button className="agent-send stop" title={t.stop} onClick={() => stopSession(current)}><span className="stop-square" /></button>
          : <button className="agent-send" title={t.send} disabled={!text.trim() || sending || !info?.available} onClick={() => void send()}><Icon name="arrowRight" size={15} /></button>}
      </div>
    </div>
  );
}

interface Totals { messages: number; inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number }
interface Budget { tokensPerMessage?: number; usdPerMessage?: number }

/** This month's tokens and cost across all chats, and the budget for one message. */
function UsageFooter() {
  const t = useT();
  const running = useAgent((s) => s.sessions.some((x) => x.running));
  const [totals, setTotals] = useState<Totals | undefined>();
  const [budget, setBudget] = useState<Budget>({});
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (running) return;
    void fetch('/api/agent/usage', { headers: authHeaders() }).then((r) => r.json()).then((j: { usage: Totals; settings: Budget }) => { setTotals(j.usage); setBudget(j.settings); }).catch(() => {});
  }, [running]);
  if (!totals) return null;
  const n = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : x >= 1000 ? `${Math.round(x / 1000)}k` : String(x));
  const save = (next: Budget) => void post<{ settings: Budget }>('/api/agent/settings', next).then((r) => setBudget(r.settings), (e: Error) => toast(e.message));
  return (
    <div className="agent-footer">
      <span>{t.thisMonth}: {n(totals.inputTokens + totals.outputTokens)} {t.tokens}{totals.inputTokens ? ` (${Math.round((totals.cachedTokens / totals.inputTokens) * 100)}% ${t.cached})` : ''}{totals.costUsd ? ` · ${totals.costUsd < 0.01 ? '<$0.01' : `$${totals.costUsd.toFixed(2)}`}` : ''}</span>
      <button onClick={() => setEditing(!editing)}>{budget.tokensPerMessage || budget.usdPerMessage ? t.budgetSet(budget.tokensPerMessage ? `${n(budget.tokensPerMessage)} ${t.tokens}` : `$${budget.usdPerMessage}`) : t.budget}</button>
      {editing && (
        <form className="agent-budget" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); save({ tokensPerMessage: Number(f.get('tokens')) || undefined, usdPerMessage: Number(f.get('usd')) || undefined }); setEditing(false); }}>
          <label>{t.budgetTokens}<input name="tokens" type="number" min="0" step="10000" defaultValue={budget.tokensPerMessage ?? ''} placeholder="500000" onKeyDown={(e) => e.stopPropagation()} /></label>
          <label>{t.budgetUsd}<input name="usd" type="number" min="0" step="0.1" defaultValue={budget.usdPerMessage ?? ''} placeholder="1.00" onKeyDown={(e) => e.stopPropagation()} /></label>
          <button type="submit">{t.saveKey}</button>
          <span className="dim">{t.budgetHint}</span>
        </form>
      )}
    </div>
  );
}

/** Which agent and model to use: the person's Claude or Codex, or an API model. */
export function ModelPicker() {
  const t = useT();
  const providers = useAgent((s) => s.providers);
  const provider = useAgent((s) => s.provider);
  const model = useAgent((s) => s.model);
  return (
    <select className="agent-model" value={`${provider}|${model}`} onChange={(e) => { const [p, m] = e.target.value.split('|'); choose(p, m ?? ''); }}>
      {providers.map((p) => (
        <optgroup key={p.id} label={p.name}>
          {p.available
            ? p.models.map((m) => <option key={m.id} value={`${p.id}|${m.id}`}>{p.name} · {m.label}</option>)
            : <option value={`${p.id}|`}>{p.name} · {p.auth === 'key' ? t.needsKey : p.signIn ? t.needsSignIn : t.unavailable}</option>}
        </optgroup>
      ))}
    </select>
  );
}

/** What a provider needs before it can run: an API key nib keeps, or the person's sign-in in its app. */
function ProviderSetup({ info }: { info: ProviderInfo }) {
  const t = useT();
  const [key, setKey] = useState('');
  if (info.auth !== 'key') {
    return (
      <div className="agent-setup">
        <span>{info.note}</span>
        {info.signIn && (
          <div className="agent-key">
            <button type="button" onClick={() => signIn(info.id).then((ok) => { if (!ok) toast(t.signInManually(info.signIn!)); }, (e: Error) => toast(e.message))}>{t.signInTerminal}</button>
            <button type="button" className="secondary" onClick={() => void refreshProviders(true)}>{t.checkAgain}</button>
          </div>
        )}
        {info.signIn && <span className="dim">{t.signInHint(info.signIn)}</span>}
      </div>
    );
  }
  return (
    <form className="agent-setup" onSubmit={(e) => { e.preventDefault(); if (key.trim()) saveKey(info.id, key.trim()).then(() => setKey(''), (err: Error) => toast(err.message)); }}>
      <span>{t.apiKeyFor(info.name)}</span>
      <div className="agent-key">
        <input type="password" value={key} placeholder="sk-…" autoComplete="off" onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button type="submit" disabled={!key.trim()}>{t.saveKey}</button>
      </div>
      <span className="dim">{t.keyHint}</span>
    </form>
  );
}
