import { useEffect, useState } from 'react';
import { authHeaders } from '../app/connection.ts';
import { childrenOf, resolveVariable, defaultTheme, type PenDoc } from '@nib/core';
import type { Node, Variable } from '@nib/format';
import { commit, isContainer, setProps } from '../app/actions.ts';
import { useT } from '../app/i18n.ts';
import { store, toast, useEditor, type LeftTab } from '../app/store.ts';
import { desktop } from '../app/desktop.ts';
import { boundsOf, fitView } from '../canvas/Canvas.tsx';
import { Icon } from './Icon.tsx';
import { Components, Libraries } from './Libraries.tsx';
import type { IconName } from './icons.ts';
import { Slides } from './Slides.tsx';
import { Strings } from './Strings.tsx';
import { loadAgent, openSession, sendMessage } from '../app/agent.ts';

export function typeIcon(n: Node): IconName {
  if (n.reusable) return 'component';
  switch (n.type) {
    case 'frame': return (n as { metadata?: { type?: string } }).metadata?.type === 'nib-mask' ? 'mask' : n.layout === 'none' ? 'hash' : 'frame';
    case 'group': return 'grid';
    case 'rectangle': return 'square';
    case 'ellipse': return 'circle';
    case 'text': return 'type';
    case 'icon': return 'smile';
    case 'ref': return 'diamond';
    case 'path': case 'polygon': return 'penTool';
    case 'note': case 'context': case 'prompt': return 'note';
    case 'browser': return 'globe';
    default: return 'box';
  }
}

export function layerName(doc: PenDoc, n: Node): string {
  if (n.name) return n.name;
  if (n.type === 'text' && typeof n.content === 'string') return n.content.slice(0, 40) || 'Text';
  if (n.type === 'ref') return doc.get(n.ref)?.name ?? 'Instance';
  if (n.type === 'icon' && typeof n.icon === 'string') return n.icon;
  return n.type[0].toUpperCase() + n.type.slice(1);
}

export function LeftPanel() {
  const t = useT();
  const tab = useEditor((s) => s.leftTab);
  const tabs: [LeftTab, IconName, string][] = [['layers', 'layers', t.layers], ['slides', 'presentation', t.slides], ['components', 'component', t.components], ['libraries', 'library', t.libraries], ['variables', 'variable', t.variables], ['strings', 'text', t.strings], ['problems', 'scan', t.problems]];
  return (
    <div className="panel left-panel">
      <div className="tabs">
        {tabs.map(([id, icon, label]) => (
          <button key={id} className={`tab${tab === id ? ' active' : ''}`} title={label} onClick={() => store.set({ leftTab: id })}>
            <Icon name={icon} />{tab === id && <span>{label}</span>}
          </button>
        ))}
      </div>
      <div className="panel-body">
        {tab === 'layers' && <Layers />}
        {tab === 'slides' && <Slides />}
        {tab === 'components' && <Components />}
        {tab === 'libraries' && <Libraries />}
        {tab === 'variables' && <Variables />}
        {tab === 'strings' && <Strings />}
        {tab === 'problems' && <Problems />}
      </div>
    </div>
  );
}

function Layers() {
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  const selection = useEditor((s) => s.selection);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Reveal selected layers: expand their ancestors.
  useEffect(() => {
    if (!doc) return;
    const anc = selection.flatMap((id) => doc.ancestors(id).map((a) => a.id));
    if (anc.some((id) => !open.has(id))) setOpen(new Set([...open, ...anc]));
    document.querySelector('.layer.selected')?.scrollIntoView({ block: 'nearest' });
  }, [selection, doc]);
  if (!doc) return null;
  const toggle = (id: string) => { const next = new Set(open); next.has(id) ? next.delete(id) : next.add(id); setOpen(next); };
  const rows: React.ReactNode[] = [];
  const add = (n: Node, depth: number) => {
    const kids = childrenOf(n);
    const expanded = open.has(n.id);
    rows.push(<LayerRow key={n.id} doc={doc} node={n} depth={depth} hasKids={!!kids?.length} expanded={expanded} toggle={toggle} selected={selection.includes(n.id)} />);
    if (expanded) for (let i = (kids?.length ?? 0) - 1; i >= 0; i--) add(kids![i], depth + 1);
  };
  // Like the canvas stacking: the topmost (last) layer is listed first.
  for (let i = doc.data.children.length - 1; i >= 0; i--) add(doc.data.children[i], 0);
  return <div className="layers">{rows}</div>;
}

let dragging: string | undefined;

type DropAt = 'above' | 'below' | 'inside';

/**
 * Move `id` relative to `target` in the layer list. The list shows the topmost layer first, so "above"
 * means after the target among its siblings.
 */
function moveLayer(doc: PenDoc, id: string, target: string, at: DropAt): void {
  if (id === target || doc.ancestors(target).some((a) => a.id === id)) return;
  void commit('Move layer', (ed) => {
    if (at === 'inside') { ed.move(id, doc.get(target)!); return; }
    const t = doc.locate(target)!;
    const self = doc.locate(id)!;
    let index = at === 'above' ? t.index + 1 : t.index;
    if (self.parent === t.parent && self.index < index) index--;
    ed.move(id, t.parent, index);
  });
}

function LayerRow({ doc, node, depth, hasKids, expanded, toggle, selected }: { doc: PenDoc; node: Node; depth: number; hasKids: boolean; expanded: boolean; toggle: (id: string) => void; selected: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const [drop, setDrop] = useState<DropAt | undefined>();
  const dropAt = (e: React.DragEvent): DropAt => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - r.top) / r.height;
    if (isContainer(node) && f > 0.25 && f < 0.75) return 'inside';
    return f < 0.5 ? 'above' : 'below';
  };
  const hidden = node.enabled === false;
  const select = (e: React.MouseEvent) => {
    const { selection } = store.get();
    store.set({ selection: e.shiftKey || e.metaKey ? (selection.includes(node.id) ? selection.filter((i) => i !== node.id) : [...selection, node.id]) : [node.id] });
  };
  return (
    <div className={`layer${selected ? ' selected' : ''}${hidden ? ' hidden' : ''}${depth === 0 ? ' top' : ''}${drop ? ` drop-${drop}` : ''}`} style={{ paddingLeft: 6 + depth * 14 }}
      onClick={select} onDoubleClick={() => setRenaming(true)}
      draggable={!renaming} onDragStart={(e) => { dragging = node.id; e.dataTransfer.effectAllowed = 'move'; }}
      onDragOver={(e) => { if (!dragging || dragging === node.id) return; e.preventDefault(); setDrop(dropAt(e)); }}
      onDragLeave={() => setDrop(undefined)}
      onDrop={(e) => { e.preventDefault(); setDrop(undefined); if (dragging) moveLayer(doc, dragging, node.id, dropAt(e)); dragging = undefined; }}
      onDragEnd={() => { dragging = undefined; setDrop(undefined); }}
      onMouseEnter={() => store.set({ hover: node.id })} onMouseLeave={() => store.get().hover === node.id && store.set({ hover: undefined })}>
      <span className={`twisty${hasKids ? '' : ' none'}`} onClick={(e) => { e.stopPropagation(); toggle(node.id); }}>
        {hasKids && <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={12} />}
      </span>
      <span className={`layer-icon${node.reusable || node.type === 'ref' ? ' component' : ''}`}><Icon name={typeIcon(node)} size={14} /></span>
      {renaming
        ? <input className="rename" autoFocus defaultValue={node.name ?? ''} onClick={(e) => e.stopPropagation()}
            onBlur={(e) => { setRenaming(false); if (e.target.value !== (node.name ?? '')) void setProps([node.id], { name: e.target.value || undefined }, 'Rename'); }}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false); e.stopPropagation(); }} />
        : <span className="layer-name">{layerName(doc, node)}</span>}
      <button className="eye" title="Show / hide" onClick={(e) => { e.stopPropagation(); void setProps([node.id], { enabled: hidden ? undefined : false }, hidden ? 'Show' : 'Hide'); }}>
        <Icon name={hidden ? 'eyeOff' : 'eye'} size={13} />
      </button>
    </div>
  );
}

/** Bring tokens in from a project (CSS variables or tokens JSON), and take the variables out as tokens. */
function TokenActions() {
  const t = useT();
  const conn = useEditor((s) => s.conn);
  if (!conn) return null;
  const importFrom = async () => {
    const file = desktop ? await desktop.pickFile() : prompt(t.tokensImportHint)?.trim();
    if (!file) return;
    const r = await fetch('/api/tokens/import', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ path: conn.path, file }) });
    const j = await r.json();
    toast(r.ok ? t.tokensImported(j.count, j.skipped.length) : j.error);
  };
  const exportAs = async (format: string) => {
    const j = await (await fetch(`/api/tokens?${new URLSearchParams({ doc: conn.path, format })}`, { headers: authHeaders() })).json() as { text: string; name: string };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([j.text], { type: 'text/plain' }));
    a.download = j.name;
    a.click();
    URL.revokeObjectURL(a.href);
    await navigator.clipboard?.writeText(j.text).catch(() => {});
    toast(t.tokensExported(j.name));
  };
  return (
    <div className="token-actions">
      <button onClick={() => void importFrom()}><Icon name="download" size={12} />{t.tokensImport}</button>
      <select value="" onChange={(e) => { if (e.target.value) void exportAs(e.target.value); }}>
        <option value="">{t.tokensExport}</option>
        <option value="css">CSS variables</option>
        <option value="tailwind">Tailwind theme</option>
        <option value="json">Design tokens JSON</option>
      </select>
    </div>
  );
}

function Variables() {
  return (
    <>
      <TokenActions />
      <VariableTable />
    </>
  );
}

function VariableTable() {
  const t = useT();
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  if (!doc) return null;
  const vars = Object.entries(doc.data.variables ?? {});
  if (!vars.length) return <p className="empty">{t.noVariables}</p>;
  const themes = doc.data.themes ?? {};
  const axes = Object.entries(themes);
  // One column per value of the first theme axis (e.g. light / dark), else one value column.
  const columns = axes.length ? axes[0][1].map((v) => ({ ...defaultTheme(doc.data), [axes[0][0]]: v })) : [defaultTheme(doc.data)];
  return (
    <table className="variables">
      <thead><tr><th />{columns.map((c, i) => <th key={i}>{axes.length ? c[axes[0][0]] : ''}</th>)}</tr></thead>
      <tbody>
        {vars.map(([name, v]) => (
          <tr key={name}>
            <td className="var-name" title={name}>{name}</td>
            {columns.map((ctx, i) => <td key={i}><VarValue v={v} value={resolveVariable(doc, name, ctx)} onChange={(value) => setVariable(doc, name, v, axes.length ? { [axes[0][0]]: ctx[axes[0][0]] } : undefined, value)} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Change a variable's value for one theme (or its single value). A themed entry for exactly that theme
 * is updated or added; other entries stay.
 */
function setVariable(doc: PenDoc, name: string, v: Variable, theme: Record<string, string> | undefined, raw: string): void {
  const value: string | number | boolean = v.type === 'number' ? Number(raw) : v.type === 'boolean' ? raw === 'true' : raw;
  if (v.type === 'number' && !Number.isFinite(value)) return;
  if (v.type === 'color' && !/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(raw) && !raw.startsWith('$')) return;
  let next: Variable['value'];
  if (!theme || !Array.isArray(v.value)) next = theme && !Array.isArray(v.value) ? [{ value: v.value }, { value, theme }] : value;
  else {
    const list = v.value.map((e) => ({ ...e }));
    const same = (t?: Record<string, string>) => !!t && Object.keys(t).length === Object.keys(theme).length && Object.entries(theme).every(([k, x]) => t[k] === x);
    const hit = list.find((e) => same(e.theme));
    if (hit) hit.value = value; else list.push({ value, theme });
    next = list;
  }
  void commit(`Set ${name}`, (ed) => ed.setVariables({ ...(doc.data.variables ?? {}), [name]: { ...v, value: next } }));
}

function VarValue({ v, value, onChange }: { v: Variable; value: unknown; onChange: (raw: string) => void }) {
  const [editing, setEditing] = useState(false);
  const text = value === undefined ? '' : String(value);
  if (editing) {
    return <input className="var-input" autoFocus defaultValue={text}
      onBlur={(e) => { setEditing(false); if (e.target.value !== text) onChange(e.target.value); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setEditing(false); e.stopPropagation(); }} />;
  }
  if (v.type === 'color' && typeof value === 'string') return <span className="var-color" onDoubleClick={() => setEditing(true)}><i style={{ background: value }} />{value}</span>;
  return <span className="var-plain" onDoubleClick={() => setEditing(true)}>{value === undefined ? '—' : String(value)}</span>;
}

/** Problems the daemon finds in the whole document; refreshed after changes. */
type Finding = { id: string; message: string; kind?: string };

type Scenario = 'long' | 'cjk' | 'rtl' | 'dark' | 'narrow';
/** A stress test's copies with what broke on each (`of`: the layer in the original). */
type Stress = { frame: string; copies: { scenario: Scenario; frame: string; findings: (Finding & { of: string })[] }[]; skipped: { scenario: Scenario; reason: string }[] };
/** The last stress test per document, so it outlives switching tabs. */
const stressByDoc = new Map<string, Stress>();

function Problems() {
  const t = useT();
  const conn = useEditor((s) => s.conn);
  const version = useEditor((s) => s.version);
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  const [problems, setProblems] = useState<Finding[] | undefined>();
  const [review, setReview] = useState<Finding[]>([]);
  const [stress, setStressState] = useState<Stress | 'running' | undefined>(() => (conn ? stressByDoc.get(conn.path) : undefined));
  const setStress = (s: Stress | undefined) => { if (conn) { if (s) stressByDoc.set(conn.path, s); else stressByDoc.delete(conn.path); } setStressState(s); };
  // The review covers the selected top-level frame, else the whole document.
  const top = selection.length === 1 ? doc?.topLevel(selection[0])?.id : undefined;
  useEffect(() => {
    if (!conn) return;
    const h = setTimeout(() => {
      fetch(`/api/problems?${new URLSearchParams({ doc: conn.path })}`, { headers: authHeaders() })
        .then((r) => r.json()).then((j) => setProblems(j.problems ?? [])).catch(() => setProblems([]));
      fetch(`/api/review?${new URLSearchParams({ doc: conn.path, ...(top ? { frame: top } : {}) })}`, { headers: authHeaders() })
        .then((r) => r.json()).then((j) => setReview(j.items ?? [])).catch(() => setReview([]));
    }, 400);
    return () => clearTimeout(h);
  }, [conn, version, top]);
  if (!problems) return <p className="empty">{t.loading}</p>;
  const show = (id: string) => { if (doc?.has(id)) { store.set({ selection: [id] }); const b = boundsOf([id]); if (b) store.set({ view: fitView(b, 2) }); } };
  const row = (p: Finding, i: number) => (
    <button key={i} className="problem" onClick={() => show(p.id)}>
      <span className="problem-node">{doc?.get(p.id) ? layerName(doc, doc.get(p.id)!) : p.id}</span>
      <span className="problem-text">{p.message}</span>
    </button>
  );
  const scope = top && doc?.get(top) ? layerName(doc, doc.get(top)!) : t.wholeDocument;
  const ask = async (text: string, ids: string[]) => {
    if (!conn) return;
    store.set({ agentOpen: true, activityOpen: false, browserOpen: false });
    try {
      await loadAgent(conn.path);
      await openSession(undefined);
      await sendMessage(conn.path, text, ids);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const kinds = ['contrast', 'small-text', 'touch-target', 'cut-off', 'overflow', 'alignment', 'spacing'] as const;
  const runStress = async () => {
    if (!conn || !top) return;
    setStressState('running');
    try {
      const r = await fetch('/api/stress', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ doc: conn.path, frame: top }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      const result: Stress = { frame: top, copies: j.copies, skipped: j.skipped };
      setStress(result);
      // Show the original with its copies once they have arrived.
      const ids = [top, ...result.copies.map((c) => c.frame)];
      for (let i = 0; i < 60 && !ids.every((id) => boundsOf([id])); i++) await new Promise((res) => setTimeout(res, 50));
      const b = boundsOf(ids);
      if (b) store.set({ view: fitView(b) });
    } catch (e) {
      setStress(undefined);
      toast((e as Error).message);
    }
  };
  const stressDone = stress && stress !== 'running' ? stress : undefined;
  const stressName = stressDone && doc?.get(stressDone.frame) ? layerName(doc, doc.get(stressDone.frame)!) : '';
  const fixStress = (s: Stress) => {
    const lines = s.copies.flatMap((c) => c.findings.slice(0, 12).map((f) => `- ${t.stressScenarios[c.scenario]} · ${f.of}: ${f.message}`));
    void ask(t.stressFixPrompt(stressName, s.frame, lines.slice(0, 40).join('\n')), [s.frame, ...new Set(s.copies.flatMap((c) => c.findings.map((f) => f.of)))].filter((id) => doc?.has(id)));
  };
  const removeStress = async (s: Stress) => {
    if (await commit('Remove stress copies', (ed, d) => { for (const c of s.copies) if (d.has(c.frame)) ed.remove(c.frame); })) setStress(undefined);
  };
  return (
    <div className="problems">
      <div className="review-head">
        <span className="review-title">{t.designReview} · {scope}</span>
        <div className="review-actions">
          {review.length > 0 && <button className="link" onClick={() => void ask(t.fixReviewPrompt(scope, review.slice(0, 30).map((r) => `- ${r.id}: ${r.message}`).join('\n')), [...new Set(review.slice(0, 30).map((r) => r.id))])}>{t.fixWithAgent}</button>}
          <button className="link" onClick={() => void ask(t.reviewPrompt(scope, top), top ? [top] : [])}>{t.askAgentReview}</button>
          {top && <button className="link" title={t.stressHint} disabled={stress === 'running'} onClick={() => void runStress()}>{stress === 'running' ? t.stressRunning : t.stressTest}</button>}
        </div>
      </div>
      {!review.length && <p className="empty small">{t.reviewClean}</p>}
      {kinds.map((k) => {
        const items = review.filter((r) => r.kind === k);
        return items.length ? <div key={k}><div className="review-kind">{t.reviewKinds[k]} · {items.length}</div>{items.map(row)}</div> : null;
      })}
      {stressDone && (
        <>
          <div className="review-head">
            <span className="review-title">{t.stressOf(stressName || stressDone.frame)}</span>
            <div className="review-actions">
              {stressDone.copies.some((c) => c.findings.length) && <button className="link" onClick={() => fixStress(stressDone)}>{t.fixWithAgent}</button>}
              <button className="link danger" onClick={() => void removeStress(stressDone)}>{t.removeStressCopies}</button>
            </div>
          </div>
          {stressDone.copies.map((c) => (
            <div key={c.frame}>
              <button className="review-kind stress-scenario" onClick={() => show(c.frame)}>{t.stressScenarios[c.scenario]} · {c.findings.length || t.stressHolds}</button>
              {c.findings.map(row)}
            </div>
          ))}
          {stressDone.skipped.map((s) => <div key={s.scenario} className="review-kind" title={s.reason}>{t.stressScenarios[s.scenario]} · {t.stressSkipped}</div>)}
        </>
      )}
      <div className="review-head"><span className="review-title">{t.problems}</span></div>
      {problems.length ? problems.map(row) : <p className="empty small">{t.noProblems}</p>}
    </div>
  );
}
