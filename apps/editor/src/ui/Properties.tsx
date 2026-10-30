import { useEffect, useState } from 'react';
import type { PenDoc } from '@nib/core';
import type { Node, RefNode } from '@nib/format';
import { align, isFree, setProps, type Align } from '../app/actions.ts';
import { authHeaders } from '../app/connection.ts';
import { toast } from '../app/store.ts';
import { useT, type Strings } from '../app/i18n.ts';
import { store, useEditor } from '../app/store.ts';
import { boundsOf, canvas, fitView } from '../canvas/Canvas.tsx';
import { Icon } from './Icon.tsx';
import { layerName, typeIcon } from './LeftPanel.tsx';

type Props = Record<string, any>;

const isVar = (v: unknown): v is string => typeof v === 'string' && v.startsWith('$');
const SIZE_RE = /^(fit_content|fill_container)(?:\((-?\d+(?:\.\d+)?)\))?$/;
const HAS_SIZE = new Set(['frame', 'rectangle', 'ellipse', 'polygon', 'path', 'text', 'icon', 'note', 'prompt', 'context', 'ref', 'script', 'browser']);
const HAS_FILL = new Set(['frame', 'rectangle', 'ellipse', 'polygon', 'path', 'text', 'icon']);
const HAS_STROKE = new Set(['frame', 'rectangle', 'ellipse', 'polygon', 'path', 'text']);
const HAS_RADIUS = new Set(['frame', 'rectangle', 'polygon']);

export function Properties() {
  const t = useT();
  const doc = useEditor((s) => s.doc);
  const selection = useEditor((s) => s.selection);
  useEditor((s) => s.version);
  useEditor((s) => s.layoutVersion);
  if (!doc) return null;
  const nodes = selection.map((id) => doc.get(id)).filter((n): n is Node => !!n);
  if (!nodes.length) return <div className="panel right-panel"><p className="empty">{t.noSelection}</p></div>;
  const n = nodes[0] as Props;
  const ids = nodes.map((x) => x.id);
  const same = nodes.every((x) => x.type === n.type);
  // An instance shows (and overrides) its component root's properties.
  const comp = n.type === 'ref' ? doc.get((n as RefNode).ref) : undefined;
  const shownType = n.type === 'ref' ? comp?.type ?? 'frame' : n.type;
  const shown = (k: string) => (n[k] !== undefined ? n[k] : comp ? (comp as Props)[k] : undefined);
  const set = (props: Props, label?: string) => setProps(ids, props, label);
  return (
    <div className="panel right-panel">
      <div className="prop-header">
        <Icon name={typeIcon(n as Node)} />
        <span className="prop-title">{nodes.length > 1 ? `${nodes.length} layers` : layerName(doc, n as Node)}</span>
      </div>
      {ids.some((id) => isFree(doc, id)) && (
        <div className="align-row" title={t.align}>
          {([['left', 'alignLeft'], ['hcenter', 'alignHCenter'], ['right', 'alignRight'], ['top', 'alignTop'], ['vcenter', 'alignVCenter'], ['bottom', 'alignBottom']] as const).map(([how, icon]) => (
            <button key={how} className="icon-button" onClick={() => align(how as Align, (id) => canvas.cache?.box(id))}><Icon name={icon} size={14} /></button>
          ))}
        </div>
      )}
      {n.type === 'ref' && nodes.length === 1 && (
        <Section title={t.instance}>
          <button className="link" onClick={() => { store.set({ selection: [(n as RefNode).ref] }); const b = boundsOf([(n as RefNode).ref]); if (b) store.set({ view: fitView(b, 2) }); }}>
            <Icon name="component" size={13} /> {comp ? layerName(doc, comp) : (n as RefNode).ref}
          </button>
        </Section>
      )}
      {nodes.length === 1 && <Geometry doc={doc} n={n} t={t} shown={shown} set={set} />}
      {same && shownType === 'frame' && <Layout t={t} shown={shown} set={set} />}
      <Section title={t.appearance}>
        <div className="row">
          <Num label="%" title={t.opacity} value={shown('opacity') === undefined ? 100 : typeof shown('opacity') === 'number' ? Math.round(shown('opacity') * 100) : shown('opacity')} onChange={(v) => set({ opacity: v >= 100 ? undefined : Math.max(0, v) / 100 }, 'Opacity')} />
          {HAS_RADIUS.has(shownType) && <Num label="◜" title={t.radius} value={Array.isArray(shown('cornerRadius')) ? shown('cornerRadius')[0] : shown('cornerRadius') ?? 0} onChange={(v) => set({ cornerRadius: v || undefined }, 'Corner radius')} />}
          {shownType === 'polygon' && <Num label="⬡" title="Sides" value={shown('polygonCount') ?? 4} onChange={(v) => set({ polygonCount: Math.max(3, Math.round(v)) }, 'Sides')} />}
        </div>
        {(shownType === 'frame' || n.type === 'ref') && Object.entries(doc.data.themes ?? {}).map(([axis, values]) => (
          <div className="row" key={axis}>
            <span className="row-label">{t.theme} · {axis}</span>
            <select value={(n.theme as Record<string, string> | undefined)?.[axis] ?? ''} onChange={(e) => {
              const theme = { ...(n.theme ?? {}) } as Record<string, string>;
              if (e.target.value) theme[axis] = e.target.value; else delete theme[axis];
              set({ theme: Object.keys(theme).length ? theme : undefined }, 'Theme');
            }}>
              <option value="">—</option>
              {values.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        ))}
      </Section>
      {HAS_FILL.has(shownType) && <Fills t={t} title={t.fill} value={shown('fill')} onChange={(fill) => set({ fill }, 'Fill')} />}
      {HAS_STROKE.has(shownType) && <Strokes t={t} shown={shown} set={set} />}
      {shownType !== 'group' && <Effects t={t} value={shown('effect')} onChange={(effect) => set({ effect }, 'Effects')} />}
      {same && shownType === 'text' && <Typography t={t} shown={shown} set={set} />}
      {same && n.type === 'icon' && (
        <Section title={t.icon}>
          <div className="row">
            <Text label="lib" value={n.library ?? 'lucide'} onChange={(v) => set({ library: v === 'lucide' ? undefined : v }, 'Icon library')} />
            <Text label="name" value={n.icon ?? ''} onChange={(v) => set({ icon: v }, 'Icon')} />
          </div>
        </Section>
      )}
      <ExportSection t={t} ids={ids} />
      {nodes.length === 1 && n.type !== 'ref' && (
        <Section title={t.component}>
          <label className="check"><input type="checkbox" checked={n.reusable === true} onChange={(e) => set({ reusable: e.target.checked || undefined }, e.target.checked ? 'Make component' : 'Detach component')} /> {t.makeComponent}</label>
        </Section>
      )}
    </div>
  );
}

function Geometry({ doc, n, t, shown, set }: { doc: PenDoc; n: Props; t: Strings; shown: (k: string) => any; set: (p: Props, l?: string) => void }) {
  const free = isFree(doc, n.id);
  const box = canvas.cache?.box(n.id);
  const sizeOf = (axis: 'width' | 'height') => {
    const v = shown(axis);
    if (typeof v === 'number' || isVar(v)) return { mode: 'fixed', value: v };
    const m = typeof v === 'string' ? SIZE_RE.exec(v) : null;
    if (m) return { mode: m[1] === 'fill_container' ? 'fill' : 'fit', value: undefined };
    const type = n.type === 'ref' ? 'frame' : n.type;
    if (type === 'frame' || (type === 'text' && (n.textGrowth ?? 'auto') === 'auto')) return { mode: 'fit', value: undefined };
    return { mode: 'fixed', value: 0 };
  };
  const sizeField = (axis: 'width' | 'height', label: string) => {
    const s = sizeOf(axis);
    const laid = box ? Math.round(axis === 'width' ? box.width : box.height) : undefined;
    return (
      <div className="size-field">
        <Num label={label} value={s.mode === 'fixed' ? s.value : laid} dim={s.mode !== 'fixed'} onChange={(v) => set({ [axis]: Math.max(0, v), ...(n.type === 'text' && axis === 'width' && (n.textGrowth ?? 'auto') === 'auto' ? { textGrowth: 'fixed-width' } : {}) }, 'Resize')} />
        {HAS_SIZE.has(n.type) && (
          <select value={s.mode} title={t.size} onChange={(e) => {
            const mode = e.target.value;
            set({ [axis]: mode === 'fixed' ? laid ?? 100 : mode === 'fill' ? 'fill_container' : n.type === 'frame' ? undefined : 'fit_content' }, 'Sizing');
          }}>
            <option value="fixed">{t.fixed}</option>
            <option value="fit">{t.fit}</option>
            <option value="fill">{t.fillContainer}</option>
          </select>
        )}
      </div>
    );
  };
  return (
    <Section title={t.position}>
      {free && (
        <div className="row">
          <Num label="X" value={n.x ?? 0} onChange={(v) => set({ x: v }, 'Move')} />
          <Num label="Y" value={n.y ?? 0} onChange={(v) => set({ y: v }, 'Move')} />
          <Num label="°" title={t.rotation} value={n.rotation ?? 0} onChange={(v) => set({ rotation: v || undefined }, 'Rotate')} />
        </div>
      )}
      {HAS_SIZE.has(n.type) && <div className="row">{sizeField('width', 'W')}{sizeField('height', 'H')}</div>}
    </Section>
  );
}

function Layout({ t, shown, set }: { t: Strings; shown: (k: string) => any; set: (p: Props, l?: string) => void }) {
  const layout = shown('layout') ?? 'horizontal';
  const pad = shown('padding');
  const pads = Array.isArray(pad) ? (pad.length === 2 ? [pad[0], pad[1], pad[0], pad[1]] : pad) : [pad ?? 0, pad ?? 0, pad ?? 0, pad ?? 0];
  const setPad = (i: number, v: number) => {
    const next = [...pads];
    next[i] = v;
    const [tp, r, b, l] = next;
    set({ padding: tp === r && r === b && b === l ? (tp || undefined) : tp === b && r === l ? [tp, r] : next }, 'Padding');
  };
  return (
    <Section title={t.layout}>
      <div className="segmented">
        {([['none', t.free, 'hash'], ['horizontal', t.horizontal, 'arrowRight'], ['vertical', t.vertical, 'arrowDown']] as const).map(([v, label, icon]) => (
          <button key={v} className={layout === v ? 'on' : ''} title={label} onClick={() => set({ layout: v === 'horizontal' ? undefined : v }, 'Layout')}><Icon name={icon} size={14} /></button>
        ))}
      </div>
      {layout !== 'none' && (
        <>
          <div className="row">
            <Num label={t.gap} value={shown('gap') ?? 0} onChange={(v) => set({ gap: v || undefined }, 'Gap')} />
            <select value={shown('justifyContent') ?? 'start'} onChange={(e) => set({ justifyContent: e.target.value === 'start' ? undefined : e.target.value }, 'Justify')}>
              {['start', 'center', 'end', 'space_between', 'space_around'].map((v) => <option key={v} value={v}>{v.replace('_', ' ')}</option>)}
            </select>
            <select value={shown('alignItems') ?? 'start'} onChange={(e) => set({ alignItems: e.target.value === 'start' ? undefined : e.target.value }, 'Align')}>
              {['start', 'center', 'end'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
        </>
      )}
      <div className="row pads" title={t.padding}>
        {['↑', '→', '↓', '←'].map((l, i) => <Num key={i} label={l} value={pads[i]} onChange={(v) => setPad(i, v)} />)}
      </div>
      <label className="check"><input type="checkbox" checked={shown('clip') === true} onChange={(e) => set({ clip: e.target.checked || undefined }, 'Clip')} /> {t.clip}</label>
    </Section>
  );
}

function Fills({ t, title, value, onChange }: { t: Strings; title: string; value: unknown; onChange: (v: unknown) => void }) {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const write = (next: unknown[]) => onChange(next.length === 0 ? undefined : next.length === 1 ? next[0] : next);
  return (
    <Section title={title} add={() => write([...list, '#D9D9D9'])}>
      {list.map((f, i) => (
        <FillRow key={i} fill={f} t={t} onChange={(v) => write(list.map((x, j) => (j === i ? v : x)))} onRemove={() => write(list.filter((_, j) => j !== i))} />
      ))}
    </Section>
  );
}

function FillRow({ fill, t, onChange, onRemove }: { fill: any; t: Strings; onChange: (v: unknown) => void; onRemove: () => void }) {
  const color = typeof fill === 'string' ? fill : fill?.type === 'color' ? fill.color : undefined;
  return (
    <div className="row fill-row">
      {color !== undefined ? <ColorField value={color} onChange={(c) => onChange(typeof fill === 'string' ? c : { ...fill, color: c })} /> : <span className="fill-kind">{fillKind(fill, t)}</span>}
      <button className="icon-button" onClick={onRemove}><Icon name="minus" size={13} /></button>
    </div>
  );
}

function fillKind(f: any, t: Strings): string {
  if (f?.type === 'gradient') return `${f.gradientType ?? 'linear'} gradient`;
  if (f?.type === 'image') return `image · ${String(f.url ?? '').split('/').pop()}`;
  return f?.type ?? t.mixed;
}

function Strokes({ t, shown, set }: { t: Strings; shown: (k: string) => any; set: (p: Props, l?: string) => void }) {
  const w = shown('strokeWidth');
  return (
    <>
      <Fills t={t} title={t.stroke} value={shown('stroke')} onChange={(stroke) => set({ stroke, ...(stroke !== undefined && w === undefined ? { strokeWidth: 1 } : {}) }, 'Stroke')} />
      {shown('stroke') !== undefined && (
        <div className="row indent">
          {typeof w === 'object' && w !== null
            ? (['top', 'right', 'bottom', 'left'] as const).map((side) => <Num key={side} label={side[0].toUpperCase()} value={w[side] ?? 0} onChange={(v) => set({ strokeWidth: { ...w, [side]: v } }, 'Stroke width')} />)
            : <Num label="W" value={w ?? 1} onChange={(v) => set({ strokeWidth: v }, 'Stroke width')} />}
          <select value={shown('strokeAlignment') ?? 'inner'} onChange={(e) => set({ strokeAlignment: e.target.value === 'inner' ? undefined : e.target.value }, 'Stroke alignment')}>
            {['inner', 'center', 'outer'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
      )}
    </>
  );
}

function Effects({ t, value, onChange }: { t: Strings; value: unknown; onChange: (v: unknown) => void }) {
  const list: any[] = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const write = (next: unknown[]) => onChange(next.length === 0 ? undefined : next.length === 1 ? next[0] : next);
  return (
    <Section title={t.effects} add={() => write([...list, { type: 'shadow', offset: { x: 0, y: 4 }, blur: 12, color: '#0000001F' }])}>
      {list.map((e, i) => {
        const put = (patch: Props) => write(list.map((x, j) => (j === i ? { ...x, ...patch } : x)));
        return (
          <div key={i} className="effect">
            <div className="row">
              <select value={e.type === 'shadow' ? (e.shadowType === 'inner' ? 'inner' : 'drop') : e.type} onChange={(ev) => {
                const v = ev.target.value;
                put(v === 'drop' || v === 'inner' ? { type: 'shadow', shadowType: v === 'inner' ? 'inner' : undefined } : { type: v, radius: e.radius ?? e.blur ?? 8 });
              }}>
                <option value="drop">Drop shadow</option><option value="inner">Inner shadow</option><option value="blur">Layer blur</option><option value="background_blur">Background blur</option>
              </select>
              <button className="icon-button" onClick={() => write(list.filter((_, j) => j !== i))}><Icon name="minus" size={13} /></button>
            </div>
            {e.type === 'shadow' ? (
              <div className="row">
                <Num label="X" value={e.offset?.x ?? 0} onChange={(v) => put({ offset: { ...(e.offset ?? { y: 0 }), x: v } })} />
                <Num label="Y" value={e.offset?.y ?? 0} onChange={(v) => put({ offset: { ...(e.offset ?? { x: 0 }), y: v } })} />
                <Num label="B" value={e.blur ?? 0} onChange={(v) => put({ blur: v })} />
                <Num label="S" value={e.spread ?? 0} onChange={(v) => put({ spread: v || undefined })} />
              </div>
            ) : <div className="row"><Num label="R" value={e.radius ?? 0} onChange={(v) => put({ radius: v })} /></div>}
            {e.type === 'shadow' && <div className="row"><ColorField value={e.color ?? '#00000040'} onChange={(c) => put({ color: c })} /></div>}
          </div>
        );
      })}
    </Section>
  );
}

function Typography({ t, shown, set }: { t: Strings; shown: (k: string) => any; set: (p: Props, l?: string) => void }) {
  return (
    <Section title={t.typography}>
      <div className="row"><Text label="Aa" value={shown('fontFamily') ?? 'Inter'} onChange={(v) => set({ fontFamily: v === 'Inter' ? undefined : v }, 'Font')} /></div>
      <div className="row">
        <Num label="px" value={shown('fontSize') ?? 14} onChange={(v) => set({ fontSize: Math.max(1, v) }, 'Font size')} />
        <select value={String(shown('fontWeight') ?? '400')} onChange={(e) => set({ fontWeight: e.target.value === '400' ? undefined : e.target.value }, 'Font weight')}>
          {['100', '200', '300', '400', '500', '600', '700', '800', '900'].map((w) => <option key={w} value={w}>{w}</option>)}
          {!/^\d+$/.test(String(shown('fontWeight') ?? '400')) && <option value={String(shown('fontWeight'))}>{String(shown('fontWeight'))}</option>}
        </select>
      </div>
      <div className="row">
        <Num label="↕" title="Line height" step={0.05} value={shown('lineHeight') ?? 0} onChange={(v) => set({ lineHeight: v || undefined }, 'Line height')} />
        <Num label="↔" title="Letter spacing" step={0.1} value={shown('letterSpacing') ?? 0} onChange={(v) => set({ letterSpacing: v || undefined }, 'Letter spacing')} />
      </div>
      <div className="row">
        <div className="segmented">
          {['left', 'center', 'right', 'justify'].map((a) => <button key={a} className={(shown('textAlign') ?? 'left') === a ? 'on' : ''} onClick={() => set({ textAlign: a === 'left' ? undefined : a }, 'Align text')}>{a[0].toUpperCase()}</button>)}
        </div>
        <select value={shown('textGrowth') ?? 'auto'} onChange={(e) => set({ textGrowth: e.target.value === 'auto' ? undefined : e.target.value, ...(e.target.value === 'auto' ? { width: undefined, height: undefined } : {}) }, 'Text sizing')}>
          <option value="auto">auto</option><option value="fixed-width">fixed width</option><option value="fixed-width-height">fixed</option>
        </select>
      </div>
    </Section>
  );
}

function Section({ title, add, children }: { title: string; add?: () => void; children?: React.ReactNode }) {
  return (
    <div className="section">
      <div className="section-title"><span>{title}</span>{add && <button className="icon-button" onClick={add}><Icon name="plus" size={13} /></button>}</div>
      {children}
    </div>
  );
}

/** A number field that commits on Enter or blur; `$variable` values are shown, not edited. */
function Num({ label, title, value, onChange, step = 1, dim }: { label: string; title?: string; value: unknown; onChange: (v: number) => void; step?: number; dim?: boolean }) {
  const shown = isVar(value) ? value : typeof value === 'number' ? String(Math.round(value * 100) / 100) : '';
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const done = () => {
    const v = Number(text);
    if (text !== shown && text.trim() !== '' && Number.isFinite(v)) onChange(v);
    else setText(shown);
  };
  return (
    <label className={`num${dim ? ' dim' : ''}`} title={title}>
      <span className="num-label">{label}</span>
      <input value={text} readOnly={isVar(value)} onChange={(e) => setText(e.target.value)} onBlur={done}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = (Number(text) || 0) + (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            onChange(Math.round(v * 100) / 100);
          }
          e.stopPropagation();
        }} />
    </label>
  );
}

function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="num wide">
      <span className="num-label">{label}</span>
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onChange(text)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
    </label>
  );
}

/** A color: swatch (system picker) and hex text with alpha; variable references are shown as chips. */
function ColorField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  if (value.startsWith("$")) return <span className="var-chip"><Icon name="variable" size={12} /> {value.slice(1)}</span>;
  const hex = /^#[0-9a-f]{6}/i.test(value) ? value.slice(0, 7) : /^#[0-9a-f]{3}$/i.test(value) ? `#${value.slice(1).split('').map((c) => c + c).join('')}` : '#000000';
  const alpha = value.length === 9 ? value.slice(7) : '';
  return (
    <span className="color-field">
      <span className="swatch" style={{ background: value }}><input type="color" value={hex} onChange={(e) => onChange(`${e.target.value.toUpperCase()}${alpha}`)} /></span>
      <input className="hex" value={text} onChange={(e) => setText(e.target.value)}
        onBlur={() => { if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) && text !== value) onChange(text.toUpperCase()); else setText(value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
    </span>
  );
}


/** Export the selection through the daemon (same renderer as agents' Export) and download the files. */
function ExportSection({ t, ids }: { t: Strings; ids: string[] }) {
  const [format, setFormat] = useState('png');
  const [scale, setScale] = useState(2);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    const conn = store.get().conn;
    if (!conn) return;
    setBusy(true);
    try {
      const r = await fetch('/api/export', { method: 'POST', headers: { ...authHeaders(), 'content-type': 'application/json' }, body: JSON.stringify({ filePath: conn.path, ids, format, scale }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      for (const f of j.files as { name: string; data: string }[]) {
        const bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
        const url = URL.createObjectURL(new Blob([bytes]));
        const a = document.createElement('a');
        a.href = url;
        a.download = f.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      toast(`${t.exportAs}: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title={t.exportAs}>
      <div className="row">
        <select value={format} onChange={(e) => setFormat(e.target.value)}>
          {['png', 'jpeg', 'webp', 'pdf', 'html-css', 'html-tailwind'].map((f) => <option key={f} value={f}>{f.toUpperCase().replace('HTML-', 'HTML ')}</option>)}
        </select>
        {['png', 'jpeg', 'webp', 'pdf'].includes(format) && (
          <select value={scale} onChange={(e) => setScale(Number(e.target.value))}>
            {[0.5, 1, 2, 3, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        )}
      </div>
      <button className="wide-button" disabled={busy} onClick={run}><Icon name="download" size={14} /> {t.exportButton}</button>
    </Section>
  );
}
