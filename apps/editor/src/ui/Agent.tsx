import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { choose, deleteSession, loadAgent, openSession, saveKey, sendMessage, stopSession, useAgent, type ChatItem, type ProviderInfo } from '../app/agent.ts';
import { useT } from '../app/i18n.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { boundsOf, fitView } from '../canvas/Canvas.tsx';
import { Icon } from './Icon.tsx';

/** The chat with nib's agent about this document, beside the canvas. */
export function AgentPanel() {
  const open = useEditor((s) => s.agentOpen);
  const conn = useEditor((s) => s.conn);
  useEffect(() => { localStorage.setItem('nib-agent-open', open ? '1' : '0'); }, [open]);
  useEffect(() => { if (open && conn) loadAgent(conn.path).catch((e: Error) => toast(e.message)); }, [open, conn]);
  if (!open || !conn) return null;
  return (
    <div className="panel agent-panel">
      <Header />
      <Chat />
      <Composer doc={conn.path} />
    </div>
  );
}

function Header() {
  const t = useT();
  const sessions = useAgent((s) => s.sessions);
  const current = useAgent((s) => s.current);
  return (
    <div className="agent-head">
      <Icon name="sparkles" size={14} />
      <select className="agent-sessions" value={current ?? ''} onChange={(e) => void openSession(e.target.value || undefined)}>
        <option value="">{t.newChat}</option>
        {sessions.map((s) => <option key={s.id} value={s.id}>{s.running ? '● ' : ''}{s.title || t.untitledChat}</option>)}
      </select>
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
          {item.selection?.length ? <button className="agent-sel" onClick={() => select(item.selection!)}><Icon name="diamond" size={11} />{t.selectedCount(item.selection.length)}</button> : null}
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
      return <div className="agent-usage">{usageLine(item)}</div>;
  }
}

function usageLine(u: Extract<ChatItem, { kind: 'usage' }>): string {
  const n = (x: number) => (x >= 1000 ? `${(x / 1000).toFixed(x >= 10000 ? 0 : 1)}k` : String(x));
  return [`${(u.durationMs / 1000).toFixed(1)}s`, u.inputTokens ? `${n(u.inputTokens)} in` : '', u.outputTokens ? `${n(u.outputTokens)} out` : '', u.costUsd ? `$${u.costUsd.toFixed(3)}` : ''].filter(Boolean).join(' · ');
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
        <select className="agent-model" value={`${provider}|${model}`} onChange={(e) => { const [p, m] = e.target.value.split('|'); choose(p, m ?? ''); }}>
          {providers.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {p.available
                ? p.models.map((m) => <option key={m.id} value={`${p.id}|${m.id}`}>{p.name} · {m.label}</option>)
                : <option value={`${p.id}|`} disabled={p.auth === 'app'}>{p.name} · {p.auth === 'key' ? t.needsKey : t.unavailable}</option>}
            </optgroup>
          ))}
        </select>
        {selection.length > 0 && <span className="agent-sel static" title={t.selectionContext}><Icon name="diamond" size={11} />{t.selectedCount(selection.length)}</span>}
        <span className="grow" />
        {running && current
          ? <button className="agent-send stop" title={t.stop} onClick={() => stopSession(current)}><span className="stop-square" /></button>
          : <button className="agent-send" title={t.send} disabled={!text.trim() || sending || !info?.available} onClick={() => void send()}><Icon name="arrowRight" size={15} /></button>}
      </div>
    </div>
  );
}

/** What a provider needs before it can run: an API key nib keeps, or the person's sign-in in its app. */
function ProviderSetup({ info }: { info: ProviderInfo }) {
  const t = useT();
  const [key, setKey] = useState('');
  if (info.auth !== 'key') return <div className="agent-setup">{info.note}</div>;
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
