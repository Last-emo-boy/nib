import { useEffect, useState } from 'react';
import { authHeaders } from '../app/connection.ts';
import { childrenOf, resolveVariable, defaultTheme, type PenDoc } from '@nib/core';
import type { Node, Variable } from '@nib/format';
import { setProps } from '../app/actions.ts';
import { useT } from '../app/i18n.ts';
import { store, useEditor, type LeftTab } from '../app/store.ts';
import { boundsOf, fitView } from '../canvas/Canvas.tsx';
import { Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';

export function typeIcon(n: Node): IconName {
  if (n.reusable) return 'component';
  switch (n.type) {
    case 'frame': return n.layout === 'none' ? 'hash' : 'frame';
    case 'group': return 'grid';
    case 'rectangle': return 'square';
    case 'ellipse': return 'circle';
    case 'text': return 'type';
    case 'icon': return 'smile';
    case 'ref': return 'diamond';
    case 'path': case 'polygon': return 'penTool';
    case 'note': case 'context': case 'prompt': return 'note';
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
  const tabs: [LeftTab, IconName, string][] = [['layers', 'layers', t.layers], ['components', 'component', t.components], ['variables', 'variable', t.variables], ['problems', 'scan', t.problems]];
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
        {tab === 'components' && <Components />}
        {tab === 'variables' && <Variables />}
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

function LayerRow({ doc, node, depth, hasKids, expanded, toggle, selected }: { doc: PenDoc; node: Node; depth: number; hasKids: boolean; expanded: boolean; toggle: (id: string) => void; selected: boolean }) {
  const [renaming, setRenaming] = useState(false);
  const hidden = node.enabled === false;
  const select = (e: React.MouseEvent) => {
    const { selection } = store.get();
    store.set({ selection: e.shiftKey || e.metaKey ? (selection.includes(node.id) ? selection.filter((i) => i !== node.id) : [...selection, node.id]) : [node.id] });
  };
  return (
    <div className={`layer${selected ? ' selected' : ''}${hidden ? ' hidden' : ''}${depth === 0 ? ' top' : ''}`} style={{ paddingLeft: 6 + depth * 14 }}
      onClick={select} onDoubleClick={() => setRenaming(true)}
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

function Components() {
  const t = useT();
  const doc = useEditor((s) => s.doc);
  useEditor((s) => s.version);
  if (!doc) return null;
  const comps: Node[] = [];
  const visit = (n: Node) => { if (n.reusable) comps.push(n); childrenOf(n)?.forEach(visit); };
  doc.data.children.forEach(visit);
  if (!comps.length) return <p className="empty">{t.noComponents}</p>;
  return (
    <div className="layers">
      {comps.map((c) => (
        <div key={c.id} className="layer" onClick={() => { store.set({ selection: [c.id] }); const b = boundsOf([c.id]); if (b) store.set({ view: fitView(b, 2) }); }}>
          <span className="layer-icon component"><Icon name="component" size={14} /></span>
          <span className="layer-name">{layerName(doc, c)}</span>
        </div>
      ))}
    </div>
  );
}

function Variables() {
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
            {columns.map((ctx, i) => <td key={i}><VarValue v={v} value={resolveVariable(doc, name, ctx)} /></td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VarValue({ v, value }: { v: Variable; value: unknown }) {
  if (v.type === 'color' && typeof value === 'string') return <span className="var-color"><i style={{ background: value }} />{value}</span>;
  return <span>{value === undefined ? '—' : String(value)}</span>;
}

/** Problems the daemon finds in the whole document; refreshed after changes. */
function Problems() {
  const t = useT();
  const conn = useEditor((s) => s.conn);
  const version = useEditor((s) => s.version);
  const doc = useEditor((s) => s.doc);
  const [problems, setProblems] = useState<{ id: string; message: string }[] | undefined>();
  useEffect(() => {
    if (!conn) return;
    const h = setTimeout(() => {
      fetch(`/api/problems?${new URLSearchParams({ doc: conn.path })}`, { headers: authHeaders() })
        .then((r) => r.json()).then((j) => setProblems(j.problems ?? [])).catch(() => setProblems([]));
    }, 400);
    return () => clearTimeout(h);
  }, [conn, version]);
  if (!problems) return <p className="empty">{t.loading}</p>;
  if (!problems.length) return <p className="empty">{t.noProblems}</p>;
  return (
    <div className="problems">
      {problems.map((p, i) => (
        <button key={i} className="problem" onClick={() => { if (doc?.has(p.id)) { store.set({ selection: [p.id] }); const b = boundsOf([p.id]); if (b) store.set({ view: fitView(b, 2) }); } }}>
          <span className="problem-node">{doc?.get(p.id) ? layerName(doc, doc.get(p.id)!) : p.id}</span>
          <span className="problem-text">{p.message}</span>
        </button>
      ))}
    </div>
  );
}
