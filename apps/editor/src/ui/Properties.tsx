import { useEffect, useState } from 'react';
import { hasSketch, isSketchFrame, isSketchStroke, reassignIds, type PenDoc } from '@nib/core';
import type { Node, RefNode } from '@nib/format';
import { align, commit, isFree, resetOverrides, setProps, type Align } from '../app/actions.ts';
import { isPart, layerOf, overrideOf, ownerOf } from '../app/parts.ts';
import { authHeaders } from '../app/connection.ts';
import { post } from '../app/libraries.ts';
import { toast } from '../app/store.ts';
import { useT, type Strings } from '../app/i18n.ts';
import { store, useEditor } from '../app/store.ts';
import { boundsOf, canvas, fitView } from '../canvas/Canvas.tsx';
import { resizeMesh } from '../canvas/gradient.ts';
import { flipSelection, scaleSelection } from '../canvas/arrange.ts';
import { Icon } from './Icon.tsx';
import { FontPicker } from './FontPicker.tsx';
import { LINK, linkOf } from '../canvas/links.ts';
import { imageFillIndex } from '../canvas/crop.ts';
import { agent, loadAgent, openSession, sendMessage, sendResponsive } from '../app/agent.ts';
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
  const conn = useEditor((s) => s.conn);
  useEditor((s) => s.version);
  useEditor((s) => s.layoutVersion);
  if (!doc) return null;
  // Parts of instances show as the instance shows them; changes to them become the instance's overrides.
  const nodes = selection.map((id) => layerOf(doc, id)).filter((n): n is Node => !!n);
  const parts = selection.filter(isPart);
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
            <button key={how} className="icon-button" onClick={() => align(how as Align, (id) => canvas.cache?.bounds(id))}><Icon name={icon} size={14} /></button>
          ))}
        </div>
      )}
      {n.type === 'ref' && nodes.length === 1 && (
        <Section title={t.instance}>
          <button className="link" onClick={() => { store.set({ selection: [(n as RefNode).ref] }); const b = boundsOf([(n as RefNode).ref]); if (b) store.set({ view: fitView(b, 2) }); }}>
            <Icon name="component" size={13} /> {comp ? layerName(doc, comp) : (n as RefNode).ref}
          </button>
          {(n as RefNode).descendants && <button className="link" onClick={() => void resetOverrides([n.id])}><Icon name="undo" size={12} /> {t.resetAllOverrides}</button>}
        </Section>
      )}
      {parts.length > 0 && (() => {
        const owner = doc.get(ownerOf(parts[0]));
        const changed = parts.filter((id) => overrideOf(doc, id));
        return (
          <Section title={t.instancePart}>
            <button className="link" onClick={() => store.set({ selection: [ownerOf(parts[0])] })}>
              <Icon name="diamond" size={13} /> {owner ? layerName(doc, owner) : ownerOf(parts[0])}
            </button>
            {changed.length > 0 && <button className="link" onClick={() => void resetOverrides(changed)}><Icon name="undo" size={12} /> {t.resetOverride} ({Object.keys(overrideOf(doc, changed[0]) ?? {}).join(', ')})</button>}
          </Section>
        );
      })()}
      {nodes.length === 1 && !parts.length && <Geometry doc={doc} n={n} t={t} shown={shown} set={set} />}
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
      {HAS_FILL.has(shownType) && <Fills t={t} title={t.fill} value={shown('fill')} onChange={(fill) => set({ fill }, 'Fill')} edit={nodes.length === 1 && !parts.length ? { id: n.id, prop: 'fill' } : undefined} />}
      {HAS_STROKE.has(shownType) && <Strokes t={t} shown={shown} set={set} id={nodes.length === 1 && !parts.length ? n.id : undefined} />}
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
      {nodes.length === 1 && !parts.length && imageFillIndex(n) >= 0 && (
        <Section title={t.agent}>
          <button className="link" onClick={() => void recreate(doc, n as Node, t)}><Icon name="sparkles" size={12} /> {t.recreateAsLayers}</button>
        </Section>
      )}
      {nodes.length === 1 && !parts.length && n.type === 'frame' && !doc.locate(n.id)?.parent && !hasSketch(n as Node) && (canvas.cache?.box(n.id)?.width ?? 0) > 430 && (
        <Section title={t.agent}>
          <button className="link" title={t.responsiveHint} onClick={() => void makeResponsive(doc, n as Node, t)}><Icon name="sparkles" size={12} /> {(canvas.cache?.box(n.id)?.width ?? 0) > 808 ? t.makeResponsive : t.makePhoneVersion}</button>
        </Section>
      )}
      {nodes.length === 1 && !parts.length && conn && n.type === 'script' && <ScriptSection path={conn.path} n={n} t={t} set={set} />}
      {nodes.length === 1 && !parts.length && conn && ['frame', 'rectangle', 'ellipse', 'polygon'].includes(n.type) && !hasSketch(n as Node) && <Picture path={conn.path} id={n.id} t={t} hasImage={imageFillIndex(n) >= 0} />}
      {nodes.length === 1 && !parts.length && n.type === 'frame' && !doc.locate(n.id)?.parent && !hasSketch(n as Node) && conn && <Implementation path={conn.path} id={n.id} t={t} />}
      {nodes.length === 1 && !parts.length && hasSketch(n as Node) && (
        <Section title={t.sketch}>
          <button className="link" title={t.sketchHint} onClick={() => void buildSketch(doc, n as Node, t)}><Icon name="sparkles" size={12} /> {t.buildFromSketch}</button>
        </Section>
      )}
      {nodes.length === 1 && <Prototype doc={doc} n={n} t={t} set={set} />}
      {!parts.length && <ExportSection t={t} ids={ids} />}
      {nodes.length === 1 && n.type !== 'ref' && !parts.length && (
        <Section title={t.component}>
          <label className="check"><input type="checkbox" checked={n.reusable === true} onChange={(e) => set({ reusable: e.target.checked || undefined }, e.target.checked ? 'Make component' : 'Detach component')} /> {t.makeComponent}</label>
        </Section>
      )}
    </div>
  );
}

function Geometry({ doc, n, t, shown, set }: { doc: PenDoc; n: Props; t: Strings; shown: (k: string) => any; set: (p: Props, l?: string) => void }) {
  const free = isFree(doc, n.id);
  const tool = useEditor((s) => s.tool);
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
      <div className="row">
        {tool === 'scale' && <Num label="%" title={t.scalePercent} value={100} onChange={(v) => scaleSelection(v / 100)} />}
        <button className="icon-button" title={`${t.flipHorizontal} (⇧H)`} onClick={() => flipSelection('x')}><Icon name="flipH" size={14} /></button>
        <button className="icon-button" title={`${t.flipVertical} (⇧V)`} onClick={() => flipSelection('y')}><Icon name="flipV" size={14} /></button>
      </div>
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

function Fills({ t, title, value, onChange, edit }: { t: Strings; title: string; value: unknown; onChange: (v: unknown) => void; edit?: { id: string; prop: 'fill' | 'stroke' } }) {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  const write = (next: unknown[]) => onChange(next.length === 0 ? undefined : next.length === 1 ? next[0] : next);
  const editing = useEditor((s) => s.gradientEdit);
  const crop = useEditor((s) => s.crop);
  return (
    <Section title={title} add={() => write([...list, '#D9D9D9'])}>
      {list.map((f, i) => {
        const image = (f as any)?.type === 'image';
        const on = !!edit && (image ? edit.prop === 'fill' && crop?.id === edit.id && crop.index === i : editing?.id === edit.id && editing.prop === edit.prop && editing.index === i);
        const toggle = !edit ? undefined
          : image ? (edit.prop === 'fill' ? () => store.set({ crop: on ? undefined : { id: edit.id, index: i } }) : undefined)
          : () => store.set({ gradientEdit: on ? undefined : { ...edit, index: i } });
        return (
          <FillRow key={i} fill={f} t={t} editing={on} onEdit={toggle}
            onChange={(v) => {
              write(list.map((x, j) => (j === i ? v : x)));
              // A fill turned into a gradient shows its handles.
              if (edit && v && typeof v === 'object' && kindOf(f) !== kindOf(v) && ['gradient', 'mesh_gradient'].includes((v as any).type)) store.set({ gradientEdit: { ...edit, index: i } });
            }}
            onRemove={() => write(list.filter((_, j) => j !== i))} />
        );
      })}
    </Section>
  );
}

type FillKind = 'solid' | 'linear' | 'radial' | 'angular' | 'mesh' | 'image' | 'shader' | 'other';

function kindOf(f: any): FillKind {
  if (typeof f === 'string' || f?.type === 'color') return 'solid';
  if (f?.type === 'gradient') return (f.gradientType ?? 'linear') as FillKind;
  if (f?.type === 'mesh_gradient') return 'mesh';
  if (f?.type === 'image') return 'image';
  if (f?.type === 'shader') return 'shader';
  return 'other';
}

/** A color a fill could start from when its kind changes. */
function baseColor(f: any): string {
  const c = typeof f === 'string' ? f : f?.type === 'color' ? f.color : f?.type === 'gradient' ? f.colors?.[0]?.color : f?.type === 'mesh_gradient' ? f.colors?.[0] : undefined;
  return typeof c === 'string' && /^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7).toUpperCase() : '#7048E8';
}

/** The fill as another kind, keeping its colors where it can. */
function convert(f: any, kind: FillKind): unknown {
  const base = baseColor(f);
  if (kind === 'solid') return base;
  if (kind === 'linear' || kind === 'radial' || kind === 'angular') {
    if (f?.type === 'gradient') return { ...f, gradientType: kind };
    return { type: 'gradient', gradientType: kind, ...(kind === 'linear' ? { rotation: 180 } : {}), colors: [{ color: base, position: 0 }, { color: `${base}00`, position: 1 }] };
  }
  if (kind === 'mesh') return { type: 'mesh_gradient', columns: 2, rows: 2, colors: [base, '#4DABF7', '#F783AC', '#FFD43B'] };
  if (kind === 'shader') return { type: 'shader', url: '' };
  return f;
}

function FillRow({ fill, t, editing, onEdit, onChange, onRemove }: { fill: any; t: Strings; editing: boolean; onEdit?: () => void; onChange: (v: unknown) => void; onRemove: () => void }) {
  const color = typeof fill === 'string' ? fill : fill?.type === 'color' ? fill.color : undefined;
  const kind = kindOf(fill);
  const kinds: [FillKind, string][] = [['solid', t.solid], ['linear', t.linearGradient], ['radial', t.radialGradient], ['angular', t.angularGradient], ['mesh', t.meshGradient], ['shader', t.shaderFill]];
  const stops: any[] = fill?.type === 'gradient' && Array.isArray(fill.colors) ? fill.colors : [];
  const putStops = (next: any[]) => onChange({ ...fill, colors: next });
  return (
    <div className="fill-item">
      <div className="row fill-row">
        {kind !== 'image' && kind !== 'other' && (
          <select className="fill-type" value={kind} onChange={(e) => onChange(convert(fill, e.target.value as FillKind))}>
            {kinds.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
        )}
        {color !== undefined ? <ColorField value={color} onChange={(c) => onChange(typeof fill === 'string' ? c : { ...fill, color: c })} />
          : kind === 'shader' ? <ShaderPicker t={t} effect={false} url={fill.url} onPick={(url) => onChange({ type: 'shader', url, ...(fill.opacity !== undefined ? { opacity: fill.opacity } : {}) })} />
          : kind === 'image' || kind === 'other' ? <span className="fill-kind">{fillKind(fill, t)}</span> : <span className="fill-kind fill-preview" style={{ background: previewOf(fill) }} />}
        {(fill?.type === 'gradient' || fill?.type === 'mesh_gradient') && onEdit && (
          <button className={`icon-button${editing ? ' on' : ''}`} title={t.editOnCanvas} onClick={onEdit}><Icon name="penTool" size={13} /></button>
        )}
        {fill?.type === 'image' && onEdit && (
          <button className={`icon-button${editing ? ' on' : ''}`} title={t.cropImage} onClick={onEdit}><Icon name="crop" size={13} /></button>
        )}
        <button className="icon-button" onClick={onRemove}><Icon name="minus" size={13} /></button>
      </div>
      {kind === 'shader' && fill.url && <ShaderControls t={t} url={fill.url} values={fill.uniforms} onChange={(uniforms) => onChange({ ...fill, uniforms })} />}
      {fill?.type === 'image' && (
        <div className="row indent">
          <select className="fill-type" value={imageMode(fill)} onChange={(e) => {
            const mode = e.target.value;
            if (mode === 'crop') { onEdit?.(); return; }
            // Fill, fit and stretch show the whole image again.
            const { transform: _, ...rest } = fill;
            onChange({ ...rest, mode });
          }}>
            <option value="cover">{t.imageCover}</option>
            <option value="contain">{t.imageContain}</option>
            <option value="stretch">{t.imageStretch}</option>
            {onEdit && <option value="crop">{t.cropImage}</option>}
          </select>
        </div>
      )}
      {stops.map((s, i) => (
        <div key={i} className="row stop-row">
          <ColorField value={String(s.color)} onChange={(c) => putStops(stops.map((x, j) => (j === i ? { ...x, color: c } : x)))} />
          <Num label="%" value={Math.round((s.position ?? 0) * 100)} onChange={(v) => putStops(stops.map((x, j) => (j === i ? { ...x, position: Math.max(0, Math.min(100, v)) / 100 } : x)))} />
          {stops.length > 2 && <button className="icon-button" onClick={() => putStops(stops.filter((_, j) => j !== i))}><Icon name="minus" size={13} /></button>}
        </div>
      ))}
      {stops.length > 0 && <button className="link add-stop" onClick={() => {
        // A new stop halfway between the two farthest apart.
        const sorted = [...stops].sort((a, b) => a.position - b.position);
        let at = 0.5, gap = -1;
        for (let i = 0; i + 1 < sorted.length; i++) if (sorted[i + 1].position - sorted[i].position > gap) { gap = sorted[i + 1].position - sorted[i].position; at = (sorted[i].position + sorted[i + 1].position) / 2; }
        putStops([...stops, { color: sorted[0]?.color ?? '#FFFFFF', position: Math.round(at * 1000) / 1000 }]);
      }}><Icon name="plus" size={12} /> {t.addStop}</button>}
      {fill?.type === 'mesh_gradient' && (
        <>
          <div className="row">
            <Num label="↔" title={t.meshColumns} value={fill.columns ?? 2} onChange={(v) => onChange(resizeMesh(fill, Math.max(2, Math.min(6, Math.round(v))), fill.rows ?? 2))} />
            <Num label="↕" title={t.meshRows} value={fill.rows ?? 2} onChange={(v) => onChange(resizeMesh(fill, fill.columns ?? 2, Math.max(2, Math.min(6, Math.round(v)))))} />
          </div>
          <div className="mesh-colors" style={{ gridTemplateColumns: `repeat(${fill.columns ?? 2}, 22px)` }}>
            {(fill.colors ?? []).map((c: string, i: number) => (
              <span key={i} className="swatch" style={{ background: c }}>
                <input type="color" value={/^#[0-9a-f]{6}/i.test(c) ? c.slice(0, 7) : '#000000'} onChange={(e) => onChange({ ...fill, colors: fill.colors.map((x: string, j: number) => (j === i ? e.target.value.toUpperCase() : x)) })} />
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** The colors of a gradient or mesh, left to right, for the row's preview. */
function previewOf(f: any): string {
  const colors = (f?.type === 'gradient' ? [...(f.colors ?? [])].sort((a: any, b: any) => a.position - b.position).map((c: any) => `${c.color} ${Math.round(c.position * 100)}%`) : (f?.colors ?? [])).filter((c: string) => typeof c === 'string' && c.startsWith('#'));
  return colors.length > 1 ? `linear-gradient(90deg, ${colors.join(', ')}), repeating-conic-gradient(#ccc 0 25%, #fff 0 50%) 0 0 / 8px 8px` : colors[0] ?? 'transparent';
}

/** How an image fill shows its image, as the mode menu names it: a stretched transform is a crop. */
function imageMode(f: any): string {
  const t = f.transform;
  const identity = !Array.isArray(t) || t.every((v: number, i: number) => v === [1, 0, 0, 1, 0, 0][i]);
  const mode = f.mode === 'fill' ? 'cover' : f.mode === 'fit' ? 'contain' : f.mode ?? 'cover';
  return mode === 'stretch' && !identity ? 'crop' : mode;
}

function fillKind(f: any, t: Strings): string {
  if (f?.type === 'gradient') return `${f.gradientType ?? 'linear'} gradient`;
  if (f?.type === 'image') return `image · ${String(f.url ?? '').split('/').pop()}`;
  return f?.type ?? t.mixed;
}

function Strokes({ t, shown, set, id }: { t: Strings; shown: (k: string) => any; set: (p: Props, l?: string) => void; id?: string }) {
  const w = shown('strokeWidth');
  return (
    <>
      <Fills t={t} title={t.stroke} value={shown('stroke')} onChange={(stroke) => set({ stroke, ...(stroke !== undefined && w === undefined ? { strokeWidth: 1 } : {}) }, 'Stroke')} edit={id ? { id, prop: 'stroke' } : undefined} />
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
                if (v === 'shader') { write(list.map((x, j) => (j === i ? { type: 'shader', url: '' } : x))); return; }
                put(v === 'drop' || v === 'inner' ? { type: 'shadow', shadowType: v === 'inner' ? 'inner' : undefined } : { type: v, radius: e.radius ?? e.blur ?? 8 });
              }}>
                <option value="drop">Drop shadow</option><option value="inner">Inner shadow</option><option value="blur">Layer blur</option><option value="background_blur">Background blur</option><option value="shader">{t.shaderFill}</option>
              </select>
              <button className="icon-button" onClick={() => write(list.filter((_, j) => j !== i))}><Icon name="minus" size={13} /></button>
            </div>
            {e.type === 'shader' ? (
              <>
                <div className="row"><ShaderPicker t={t} effect={true} url={e.url} onPick={(url) => write(list.map((x, j) => (j === i ? { type: 'shader', url } : x)))} /></div>
                {e.url && <ShaderControls t={t} url={e.url} values={e.uniforms} onChange={(uniforms) => put({ uniforms })} />}
              </>
            ) : e.type === 'shadow' ? (
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

type GalleryShader = { name: string; title: string; effect: boolean };
type ShaderInputInfo = { name: string; type: string; kind: 'number' | 'color' | 'boolean' | 'vector'; default: unknown; min?: number; max?: number; label: string };
let gallery: Promise<GalleryShader[]> | undefined;

/** Which shader: one of nib's (copied into the document's shaders folder), or a file next to the document. */
function ShaderPicker({ t, effect, url, onPick }: { t: Strings; effect: boolean; url: string; onPick: (url: string) => void }) {
  const conn = useEditor((s) => s.conn);
  const [list, setList] = useState<GalleryShader[]>([]);
  const [custom, setCustom] = useState(false);
  useEffect(() => {
    gallery ??= fetch('/api/shaders', { headers: authHeaders() }).then((r) => r.json()).then((j) => j.shaders as GalleryShader[]);
    void gallery.then((l) => setList(l.filter((s) => s.effect === effect)), () => setList([]));
  }, [effect]);
  const name = /^shaders\/([a-z0-9-]+)\.frag$/.exec(url)?.[1];
  const known = name && list.some((s) => s.name === name);
  if (custom || (url && !known)) {
    return <input className="shader-url" placeholder="shaders/my-shader.frag" defaultValue={url} autoFocus={custom}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { setCustom(false); onPick(e.currentTarget.value.trim()); } }}
      onBlur={(e) => { setCustom(false); if (e.target.value.trim() !== url) onPick(e.target.value.trim()); }} />;
  }
  return (
    <select className="shader-pick" value={known ? name : ''} onChange={(e) => {
      const v = e.target.value;
      if (v === '#file') { setCustom(true); return; }
      if (!v || !conn) return;
      post<{ url: string }>('/api/shaders/use', { doc: conn.path, name: v }).then((r) => onPick(r.url), (err: Error) => toast(err.message));
    }}>
      <option value="">{t.chooseShader}</option>
      {list.map((s) => <option key={s.name} value={s.name} title={s.title}>{s.name}</option>)}
      <option value="#file">{t.shaderFile}</option>
    </select>
  );
}

/** The controls a shader declares with @input, for the values stored in the fill or effect. */
function ShaderControls({ t, url, values, onChange }: { t: Strings; url: string; values?: Record<string, unknown>; onChange: (v: Record<string, unknown> | undefined) => void }) {
  const conn = useEditor((s) => s.conn);
  const version = useEditor((s) => s.version);
  const [info, setInfo] = useState<{ inputs: ShaderInputInfo[]; error?: string }>({ inputs: [] });
  useEffect(() => {
    if (!conn) return;
    fetch(`/api/shader/inputs?${new URLSearchParams({ doc: conn.path, url })}`, { headers: authHeaders() }).then((r) => r.json()).then(
      (j) => setInfo({ inputs: j.inputs ?? [], ...(j.error ? { error: j.error } : {}) }), () => setInfo({ inputs: [] }));
  }, [conn, url, version]);
  const set = (name: string, v: unknown) => {
    const next = { ...(values ?? {}), [name]: v };
    onChange(Object.keys(next).length ? next : undefined);
  };
  if (info.error) return <div className="shader-error">{t.shaderBroken(info.error)}</div>;
  return (
    <>
      {info.inputs.map((i) => {
        const v = values?.[i.name] ?? i.default;
        return (
          <div key={i.name} className="row shader-input">
            <span className="shader-label" title={i.name}>{i.label}</span>
            {i.kind === 'color' ? <ColorField value={String(v)} onChange={(c) => set(i.name, c)} />
              : i.kind === 'boolean' ? <input type="checkbox" checked={v === true} onChange={(e) => set(i.name, e.target.checked)} />
              : i.kind === 'number' && i.min !== undefined && i.max !== undefined ? (
                <>
                  <input type="range" min={i.min} max={i.max} step={(i.max - i.min) / 200} value={Number(v)} onChange={(e) => set(i.name, Number(e.target.value))} />
                  <span className="shader-value">{Math.round(Number(v) * 100) / 100}</span>
                </>
              ) : i.kind === 'number' ? <Num label="" value={Number(v)} onChange={(n) => set(i.name, n)} />
              : (Array.isArray(v) ? v : []).map((x, k) => <Num key={k} label={'xyzw'[k]} value={Number(x)} onChange={(n) => set(i.name, (v as number[]).map((y, m) => (m === k ? n : y)))} />)}
          </div>
        );
      })}
    </>
  );
}

function Typography({ t, shown, set }: { t: Strings; shown: (k: string) => any; set: (p: Props, l?: string) => void }) {
  return (
    <Section title={t.typography}>
      <div className="row"><FontPicker value={shown('fontFamily') ?? 'Inter'} onChange={(v) => set({ fontFamily: v === 'Inter' ? undefined : v }, 'Font')} /></div>
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

type ScriptInfo = { nodes: Node[]; error?: string; inputs: { name: string; kind: 'number' | 'color' | 'boolean' | 'text'; default: unknown; min?: number; max?: number; label: string }[] };

/** A script node: its file, the controls its script declares, what went wrong, and turning it into plain layers. */
function ScriptSection({ path, n, t, set }: { path: string; n: Props; t: Strings; set: (p: Props, l?: string) => void }) {
  const version = useEditor((s) => s.version);
  const [info, setInfo] = useState<ScriptInfo | undefined>();
  useEffect(() => {
    const h = setTimeout(() => {
      fetch(`/api/script?${new URLSearchParams({ doc: path, node: String(n.id) })}`, { headers: authHeaders() }).then((r) => r.json()).then(setInfo, () => setInfo(undefined));
    }, 150);
    return () => clearTimeout(h);
  }, [path, n.id, version]);
  const inputs = (n.inputs ?? {}) as Record<string, unknown>;
  const put = (name: string, v: unknown) => set({ inputs: { ...inputs, [name]: v } }, 'Script input');
  return (
    <Section title={t.script}>
      <div className="row"><input className="shader-url" defaultValue={String(n.scriptUri ?? '')} placeholder="scripts/chart.js" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={(e) => { if (e.target.value.trim() !== n.scriptUri) set({ scriptUri: e.target.value.trim() }, 'Script file'); }} /></div>
      {info?.error && <div className="shader-error">{info.error}</div>}
      {info?.inputs.map((i) => {
        const v = inputs[i.name] ?? i.default;
        return (
          <div key={i.name} className="row shader-input">
            <span className="shader-label" title={i.name}>{i.label}</span>
            {i.kind === 'color' ? <ColorField value={String(v)} onChange={(c) => put(i.name, c)} />
              : i.kind === 'boolean' ? <input type="checkbox" checked={v === true} onChange={(e) => put(i.name, e.target.checked)} />
              : i.kind === 'number' && i.min !== undefined && i.max !== undefined ? (
                <>
                  <input type="range" min={i.min} max={i.max} step={Number.isInteger(i.min) && Number.isInteger(i.max) && i.max - i.min >= 10 ? 1 : (i.max - i.min) / 100} value={Number(v)} onChange={(e) => put(i.name, Number(e.target.value))} />
                  <span className="shader-value">{Math.round(Number(v) * 100) / 100}</span>
                </>
              ) : i.kind === 'number' ? <Num label="" value={Number(v)} onChange={(x) => put(i.name, x)} />
              : <input className="shader-url" defaultValue={String(v)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }} onBlur={(e) => { if (e.target.value !== v) put(i.name, e.target.value); }} />}
          </div>
        );
      })}
      {info && info.nodes.length > 0 && <button className="link" title={t.convertToLayersHint} onClick={() => void convertScript(n, info.nodes)}>{t.convertToLayers}</button>}
    </Section>
  );
}

/** Replace a script node with a frame holding the layers its script made, as plain, editable layers. */
async function convertScript(n: Props, nodes: Node[]): Promise<void> {
  const keep = ['name', 'x', 'y', 'width', 'height', 'rotation', 'opacity', 'fill', 'stroke', 'strokeWidth', 'cornerRadius', 'effect', 'clip', 'layoutPosition', 'enabled'];
  const frame = { type: 'frame', id: String(n.id), layout: 'none', ...Object.fromEntries(keep.filter((k) => n[k] !== undefined).map((k) => [k, n[k]])), children: structuredClone(nodes) } as unknown as Node;
  await commit('Convert script to layers', (ed, d) => {
    const at = d.locate(String(n.id));
    if (!at) return;
    for (const c of (frame as unknown as { children: Node[] }).children) reassignIds(d, c);
    ed.remove(String(n.id));
    ed.insert(at.parent, frame, at.index);
  });
}

/** A picture for the layer's fill: a stock photo of what the person describes, or one an image model makes. */
function Picture({ path, id, t, hasImage }: { path: string; id: string; t: Strings; hasImage: boolean }) {
  const [prompt, setPrompt] = useState('');
  const [colors, setColors] = useState(8);
  const [working, setWorking] = useState<'vector' | 'cutout' | undefined>();
  const act = async (what: 'vector' | 'cutout', method?: 'color' | 'model') => {
    setWorking(what);
    try {
      const r = await post<{ created?: string }>(what === 'vector' ? '/api/picture/vectorize' : '/api/picture/cutout', { doc: path, node: id, ...(what === 'vector' ? { colors } : { method }) });
      if (r.created) {
        for (let i = 0; i < 40 && !store.get().doc?.has(r.created); i++) await new Promise((res) => setTimeout(res, 50));
        store.set({ selection: [r.created] });
      }
    } catch (e) {
      const message = (e as Error).message;
      if (/OpenAI API key/.test(message)) setNeedKey(true);
      // A busy background: offer the image model.
      else if (/plain background/.test(message) && confirm(t.cutoutWithModel)) void act('cutout', 'model');
      else toast(message);
    } finally {
      setWorking(undefined);
    }
  };
  const [busy, setBusy] = useState<'stock' | 'image' | undefined>();
  const [last, setLast] = useState<{ kind: 'stock' | 'image'; prompt: string; index: number; credit?: string } | undefined>();
  const [needKey, setNeedKey] = useState(false);
  useEffect(() => { setLast(undefined); setNeedKey(false); }, [id]);
  const run = async (kind: 'stock' | 'image', index = 0) => {
    const what = prompt.trim() || last?.prompt;
    if (!what) return;
    setBusy(kind);
    try {
      const r = await post<{ url: string; credit?: string }>('/api/picture', { doc: path, node: id, kind, prompt: what, index });
      setLast({ kind, prompt: what, index, ...(r.credit ? { credit: r.credit } : {}) });
    } catch (e) {
      const message = (e as Error).message;
      if (/OpenAI API key/.test(message)) setNeedKey(true); else toast(message);
    } finally {
      setBusy(undefined);
    }
  };
  return (
    <Section title={t.picture}>
      <input className="picture-prompt" placeholder={t.picturePrompt} value={prompt} onChange={(e) => setPrompt(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') void run('stock'); }} />
      <div className="row">
        <button className="link" disabled={!!busy || !(prompt.trim() || last)} title={t.stockPhotoHint} onClick={() => void run('stock')}>{busy === 'stock' ? t.searching : t.stockPhoto}</button>
        {last?.kind === 'stock' && last.index < 9 && <button className="link" disabled={!!busy} onClick={() => void run('stock', last.index + 1)}>{t.anotherPhoto}</button>}
        <button className="link" disabled={!!busy || !(prompt.trim() || last)} title={t.makePictureHint} onClick={() => void run('image')}>{busy === 'image' ? t.making : t.makePicture}</button>
      </div>
      {last?.credit && <div className="picture-credit">{last.credit}</div>}
      {hasImage && (
        <div className="row">
          <button className="link" disabled={!!working} title={t.vectorizeHint} onClick={() => void act('vector')}>{working === 'vector' ? t.tracing : t.vectorize}</button>
          <select className="picture-colors" value={colors} title={t.vectorColors} onChange={(e) => setColors(Number(e.target.value))}>
            {[2, 4, 6, 8, 12, 16, 24].map((n) => <option key={n} value={n}>{t.nColors(n)}</option>)}
          </select>
          <button className="link" disabled={!!working} title={t.removeBackgroundHint} onClick={() => void act('cutout', 'color')}>{working === 'cutout' ? t.cuttingOut : t.removeBackground}</button>
        </div>
      )}
      {needKey && (
        <div className="picture-key">
          <div className="picture-credit">{t.imageKeyHint}</div>
          <input type="password" placeholder="sk-…" onKeyDown={(e) => {
            e.stopPropagation();
            const key = e.currentTarget.value.trim();
            if (e.key === 'Enter' && key) void post('/api/agent/key', { provider: 'openai-images', key }).then(() => { setNeedKey(false); void run('image'); }).catch((err: Error) => toast(err.message));
          }} />
        </div>
      )}
    </Section>
  );
}

/** Implementation check: the running app's page at `url` against this frame, with what to change for a coding agent. */
function Implementation({ path, id, t }: { path: string; id: string; t: Strings }) {
  const key = `nib.implementation:${path}#${id}`;
  const [url, setUrl] = useState(() => localStorage.getItem(key) ?? '');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ text: string; diff?: string } | undefined>();
  useEffect(() => { setUrl(localStorage.getItem(key) ?? ''); setResult(undefined); }, [key]);
  const check = async () => {
    const target = /^[a-z]+:\/\//i.test(url.trim()) ? url.trim() : `http://${url.trim()}`;
    localStorage.setItem(key, url.trim());
    setBusy(true);
    try {
      const r = await post<{ text: string; images: { data: string }[]; isError?: boolean }>('/api/browser', { filePath: path, action: 'check-implementation', frameId: id, url: target });
      if (r.isError) { toast(r.text); setResult(undefined); } else setResult({ text: r.text, diff: r.images[0]?.data });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const lines = result?.text.split('\n') ?? [];
  const summary = lines.find((l) => l.startsWith('Pixels:'))?.replace(/^Pixels: ([\d.]+% similar).*/, '$1');
  const items = lines.filter((l) => l.startsWith('- '));
  // The report's sections, with their headings in the interface's language, at most 10 lines in all.
  const heads: Record<string, string> = { 'Differences (design → page):': t.implDifferences, 'In the design but not on the page:': t.implMissing, 'On the page but not in the design:': t.implExtra };
  const shown = lines.filter((l) => heads[l] || l.startsWith('- ')).slice(0, 12);
  return (
    <Section title={t.implementation}>
      <div className="row">
        <input className="impl-url" placeholder="localhost:3000" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && url.trim()) void check(); }} />
        <button className="link" disabled={busy || !url.trim()} title={t.implementationHint} onClick={() => void check()}>{busy ? t.checking : t.checkImplementation}</button>
      </div>
      {result && (
        <div className="impl-result">
          <div className="impl-summary">{summary ? `${summary} · ` : ''}{items.length ? t.nDifferences(items.length) : t.implementationMatches}</div>
          {shown.map((l, i) => (heads[l] ? <div key={i} className="impl-head">{heads[l]}</div> : <div key={i} className="impl-item">{l.slice(2)}</div>))}
          {shown.length < lines.filter((l) => heads[l] || l.startsWith('- ')).length && <div className="impl-item">…</div>}
          {result.diff && <img className="impl-diff" src={`data:image/png;base64,${result.diff}`} alt="" />}
          <button className="link" onClick={() => { void navigator.clipboard.writeText(`${t.implementationCopyIntro}\n\n${result.text}`).then(() => toast(t.copiedForAgent)); }}>{t.copyForCodingAgent}</button>
        </div>
      )}
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


/** Ask the agent, in a new chat, to rebuild the picture in `n` as editable layers, checking with Compare. */
async function recreate(doc: PenDoc, n: Node, t: Strings): Promise<void> {
  const conn = store.get().conn;
  if (!conn) return;
  store.set({ agentOpen: true, activityOpen: false, browserOpen: false });
  try {
    await loadAgent(conn.path);
    const s = agent.get();
    const info = s.providers.find((p) => p.id === s.provider);
    const model = info?.models.find((m) => m.id === s.model);
    if (!(model?.vision ?? info?.vision)) { toast(t.needsVision); return; }
    await openSession(undefined);
    await sendMessage(conn.path, t.recreatePrompt(layerName(doc, n), n.id), [n.id]);
  } catch (e) {
    toast((e as Error).message);
  }
}

/** Tablet and phone copies of top-level frame `n`, each adapted by its own agent; then show them all. */
async function makeResponsive(doc: PenDoc, n: Node, t: Strings): Promise<void> {
  const conn = store.get().conn;
  if (!conn) return;
  store.set({ agentOpen: true, activityOpen: false, browserOpen: false });
  try {
    await loadAgent(conn.path);
    const frames = await sendResponsive(conn.path, n.id, t.responsiveText(layerName(doc, n)));
    const ids = [n.id, ...frames];
    for (let i = 0; i < 60 && !ids.every((id) => boundsOf([id])); i++) await new Promise((res) => setTimeout(res, 50));
    const b = boundsOf(ids);
    if (b) store.set({ view: fitView(b) });
  } catch (e) {
    toast((e as Error).message);
  }
}

/** Ask the agent, in a new chat, to build the sketch in `n` (or the sketch a stroke `n` is in) as a design. */
async function buildSketch(doc: PenDoc, n: Node, t: Strings): Promise<void> {
  const conn = store.get().conn;
  if (!conn) return;
  const top = doc.topLevel(n.id);
  const target = isSketchStroke(n) && top && isSketchFrame(top) ? top : n;
  store.set({ agentOpen: true, activityOpen: false, browserOpen: false });
  try {
    await loadAgent(conn.path);
    await openSession(undefined);
    await sendMessage(conn.path, t.sketchPrompt(layerName(doc, target), target.id), [target.id]);
  } catch (e) {
    toast((e as Error).message);
  }
}

/** Prototype: where the layer leads when clicked in Present mode, and how the screen changes. */
function Prototype({ doc, n, t, set }: { doc: PenDoc; n: Props; t: Strings; set: (p: Props, l?: string) => void }) {
  const link = linkOf(n);
  const other = n.metadata && n.metadata.type !== LINK;
  const frames = doc.data.children.filter((f) => f.type === 'frame' && !f.reusable && f.id !== n.id);
  const write = (to: string, transition: string) => set({ metadata: to ? { type: LINK, to, ...(transition !== 'instant' ? { transition } : {}) } : undefined }, to ? 'Link' : 'Remove link');
  return (
    <Section title={t.prototype}>
      {other ? <p className="dim">{t.linkTaken}</p> : (
        <div className="row">
          <select className="grow" value={link?.to ?? ''} onChange={(e) => write(e.target.value, link?.transition ?? 'instant')}>
            <option value="">{t.noLink}</option>
            <option value="next">{t.nextSlide}</option>
            <option value="previous">{t.previousSlide}</option>
            {frames.map((f) => <option key={f.id} value={f.id}>{layerName(doc, f)}</option>)}
          </select>
          {link && (
            <select value={link.transition} onChange={(e) => write(link.to, e.target.value)}>
              <option value="instant">{t.instant}</option>
              <option value="dissolve">{t.dissolve}</option>
              <option value="move">{t.moveTransition}</option>
            </select>
          )}
        </div>
      )}
    </Section>
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
          {['png', 'jpeg', 'webp', 'pdf', 'html-css', 'html-tailwind', 'react-tailwind'].map((f) => <option key={f} value={f}>{f === 'react-tailwind' ? 'React + Tailwind' : f.toUpperCase().replace('HTML-', 'HTML ')}</option>)}
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
