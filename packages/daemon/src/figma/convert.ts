import type { Node, PenDocument, Variable } from '@nib/format';
import type { FigFile } from './file.ts';
import { commandsPath, networkPath } from './vector.ts';

/**
 * A Figma document as a .pen document. Pages are laid out one below the other; frames, auto layout,
 * shapes, text, vectors, images, effects, components with their instances and overrides, and variables
 * with their modes (as theme axes) carry over. What does not is listed in `notes`.
 */

interface Guid { sessionID: number; localID: number }
interface Rgba { r: number; g: number; b: number; a: number }
interface Vec { x: number; y: number }
interface Matrix { m00: number; m01: number; m02: number; m10: number; m11: number; m12: number }
interface VarData { value?: { alias?: { guid?: Guid }; colorValue?: Rgba; floatValue?: number; textValue?: string; boolValue?: boolean } }
interface Paint {
  type: string; color?: Rgba; opacity?: number; visible?: boolean; blendMode?: string;
  stops?: { color: Rgba; position: number }[]; transform?: Matrix;
  image?: { hash?: Uint8Array }; imageScaleMode?: string; colorVar?: VarData;
}
interface Effect { type: string; color?: Rgba; offset?: Vec; radius?: number; spread?: number; visible?: boolean; blendMode?: string }
interface Consumption { entries?: { variableData?: VarData; variableField?: string }[] }
interface Geometry { windingRule?: string; commandsBlob?: number }
export interface FigNode {
  guid: Guid; phase?: string; type: string; name?: string; parentIndex?: { guid: Guid; position: string };
  visible?: boolean; opacity?: number; size?: Vec; transform?: Matrix; mask?: boolean; internalOnly?: boolean;
  fillPaints?: Paint[]; strokePaints?: Paint[]; strokeWeight?: number; strokeAlign?: string; strokeCap?: string; strokeJoin?: string;
  borderStrokeWeightsIndependent?: boolean; borderTopWeight?: number; borderRightWeight?: number; borderBottomWeight?: number; borderLeftWeight?: number;
  effects?: Effect[]; cornerRadius?: number; rectangleCornerRadiiIndependent?: boolean;
  rectangleTopLeftCornerRadius?: number; rectangleTopRightCornerRadius?: number; rectangleBottomRightCornerRadius?: number; rectangleBottomLeftCornerRadius?: number;
  frameMaskDisabled?: boolean;
  stackMode?: string; stackSpacing?: number; stackHorizontalPadding?: number; stackVerticalPadding?: number; stackPaddingRight?: number; stackPaddingBottom?: number;
  stackPrimaryAlignItems?: string; stackCounterAlignItems?: string; stackPrimarySizing?: string; stackCounterSizing?: string;
  stackChildPrimaryGrow?: number; stackChildAlignSelf?: string; stackPositioning?: string; bordersTakeSpace?: boolean;
  stackWrap?: string; stackCounterSpacing?: number;
  textData?: { characters?: string; styleOverrideTable?: unknown[] }; fontName?: { family?: string; style?: string }; fontSize?: number;
  letterSpacing?: { value: number; units: string }; lineHeight?: { value: number; units: string };
  textAlignHorizontal?: string; textAlignVertical?: string; textAutoResize?: string; textDecoration?: string; textCase?: string;
  derivedTextData?: { layoutSize?: Vec; baselines?: { lineHeight?: number }[] };
  vectorData?: { vectorNetworkBlob?: number; normalizedSize?: Vec }; fillGeometry?: Geometry[]; strokeGeometry?: Geometry[];
  arcData?: { startingAngle?: number; endingAngle?: number; innerRadius?: number }; count?: number; starInnerScale?: number;
  symbolData?: { symbolID?: Guid; symbolOverrides?: Override[] }; derivedSymbolData?: Override[]; overriddenSymbolID?: Guid;
  variableSetModes?: { id: Guid; name: string; sortPosition?: string }[]; variableSetID?: { guid?: Guid }; variableResolvedType?: string;
  variableDataValues?: { entries?: { modeID?: Guid; variableData?: VarData }[] };
  variableModeBySetMap?: { entries?: { variableSetID?: { guid?: Guid }; variableModeID?: Guid }[] };
  variableConsumptionMap?: Consumption; parameterConsumptionMap?: Consumption;
}
type Override = Partial<FigNode> & { guidPath?: { guids?: Guid[] } };
type Rec = Record<string, unknown>;

export interface FigImport { doc: PenDocument; images: Map<string, Uint8Array>; notes: string[]; layers: number }

const key = (g: Guid | undefined) => (g ? `${g.sessionID}:${g.localID}` : '');
const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const byte = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
const hex = (c: Rgba | undefined, alpha = c?.a ?? 1) => (c ? `#${byte(c.r)}${byte(c.g)}${byte(c.b)}${alpha < 0.999 ? byte(alpha) : ''}` : '#000000');

const BLEND: Record<string, string> = {
  DARKEN: 'darken', MULTIPLY: 'multiply', LINEAR_BURN: 'linearBurn', COLOR_BURN: 'colorBurn', LIGHTEN: 'light', SCREEN: 'screen',
  LINEAR_DODGE: 'linearDodge', COLOR_DODGE: 'colorDodge', OVERLAY: 'overlay', SOFT_LIGHT: 'softLight', HARD_LIGHT: 'hardLight',
  DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue', SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity',
};
const ALIGN: Record<string, string> = { INSIDE: 'inner', CENTER: 'center', OUTSIDE: 'outer' };
const CAP: Record<string, string> = { ROUND: 'round', SQUARE: 'square' };
const JOIN: Record<string, string> = { MITER: 'miter', BEVEL: 'bevel', ROUND: 'round' };
const JUSTIFY: Record<string, string> = { MIN: 'start', CENTER: 'center', MAX: 'end', SPACE_BETWEEN: 'space_between', SPACE_EVENLY: 'space_between' };
const ITEMS: Record<string, string> = { MIN: 'start', CENTER: 'center', MAX: 'end', BASELINE: 'start' };
const TEXT_ALIGN: Record<string, string> = { LEFT: 'left', CENTER: 'center', RIGHT: 'right', JUSTIFIED: 'justify' };
const TEXT_VALIGN: Record<string, string> = { TOP: 'top', CENTER: 'middle', BOTTOM: 'bottom' };
/** Fields Figma variables bind to, as the .pen property they set. */
const BOUND: Record<string, string> = { CORNER_RADIUS: 'cornerRadius', STROKE_WEIGHT: 'strokeWidth', STACK_SPACING: 'gap', FONT_FAMILY: 'fontFamily', FONT_SIZE: 'fontSize', FONT_WEIGHT: 'fontWeight', LETTER_SPACING: 'letterSpacing', TEXT_DATA: 'content', VISIBLE: 'enabled', WIDTH: 'width', HEIGHT: 'height' };
const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra\s*light|ultra\s*light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi\s*bold|demi\s*bold/i, 600], [/extra\s*bold|ultra\s*bold/i, 800], [/bold/i, 700], [/black|heavy/i, 900],
];
const CONTAINERS = new Set(['FRAME', 'SYMBOL', 'INSTANCE', 'SECTION', 'COMPONENT_SET', 'GROUP', 'BOOLEAN_OPERATION']);

export function figToPen(fig: FigFile): FigImport {
  return new Converter(fig).run();
}

class Converter {
  private nodes = new Map<string, FigNode>();
  private kids = new Map<string, FigNode[]>();
  private ids = new Map<string, string>();
  private varNames = new Map<string, string>();
  private modes = new Map<string, [axis: string, mode: string]>();
  private themes: Record<string, string[]> = {};
  private variables: Record<string, Variable> = {};
  private images = new Map<string, Uint8Array>();
  private notes = new Map<string, number>();
  private blobs: Uint8Array[];
  private usedSymbols = new Set<string>();
  private placedSymbols = new Set<string>();
  private layers = 0;
  private fig: FigFile;

  constructor(fig: FigFile) {
    this.fig = fig;
    const message = fig.message as { nodeChanges?: FigNode[]; blobs?: { bytes?: Uint8Array }[] };
    this.blobs = (message.blobs ?? []).map((b) => b.bytes ?? new Uint8Array());
    for (const n of message.nodeChanges ?? []) if (n.guid && n.phase !== 'REMOVED') this.nodes.set(key(n.guid), n);
    for (const n of this.nodes.values()) {
      const p = key(n.parentIndex?.guid);
      if (!p || !this.nodes.has(p)) continue;
      let list = this.kids.get(p);
      if (!list) this.kids.set(p, (list = []));
      list.push(n);
    }
    // Fractional positions order siblings bottom to top (and in auto layout, first to last).
    for (const list of this.kids.values()) list.sort((a, b) => (a.parentIndex!.position < b.parentIndex!.position ? -1 : a.parentIndex!.position > b.parentIndex!.position ? 1 : 0));
    // Short ids: the local id, with the session's number when two sessions made the same one.
    const sessions = new Map<number, number>(), locals = new Map<number, number>();
    for (const n of this.nodes.values()) {
      if (!sessions.has(n.guid.sessionID)) sessions.set(n.guid.sessionID, sessions.size);
      locals.set(n.guid.localID, (locals.get(n.guid.localID) ?? 0) + 1);
    }
    for (const n of this.nodes.values()) this.ids.set(key(n.guid), locals.get(n.guid.localID)! > 1 ? `${n.guid.localID}-${sessions.get(n.guid.sessionID)}` : `${n.guid.localID}`);
  }

  private note(text: string): void { this.notes.set(text, (this.notes.get(text) ?? 0) + 1); }
  private id(g: Guid | undefined): string { return this.ids.get(key(g)) ?? key(g).replace(':', '-'); }
  private children(n: FigNode): FigNode[] { return this.kids.get(key(n.guid)) ?? []; }

  run(): FigImport {
    this.readVariables();
    const doc = [...this.nodes.values()].find((n) => n.type === 'DOCUMENT');
    const pages = doc ? this.children(doc).filter((c) => c.type === 'CANVAS' && !c.internalOnly) : [];
    const out: Node[] = [];
    let bottom: number | undefined;
    for (const page of pages) {
      const tops = this.convertChildren(page, undefined);
      if (!tops.length) continue;
      const box = bounds(tops);
      // Each page below the one before it.
      const dy = bottom === undefined ? 0 : bottom + 600 - box.y;
      for (const t of tops) { t.y = r2((t.y ?? 0) + dy); if (pages.length > 1) t.context = `Figma page "${page.name ?? ''}"`; }
      bottom = box.y + dy + box.height;
      out.push(...tops);
    }
    // Components that instances use but that are on no page (Figma keeps library components out of sight), beside the rest.
    const missing = [...this.usedSymbols].filter((s) => !this.placedSymbols.has(s));
    if (missing.length) {
      const box = out.length ? bounds(out) : { x: 0, y: 0, width: 0, height: 0 };
      let y = box.y;
      for (const s of missing) {
        const sym = this.nodes.get(s)!;
        const node = this.node(sym, undefined);
        if (!node) continue;
        node.x = r2(box.x + box.width + 400);
        node.y = r2(y);
        y += (sym.size?.y ?? 0) + 80;
        out.push(node);
      }
    }
    const pen: PenDocument = { version: '2.20', children: out };
    if (Object.keys(this.themes).length) pen.themes = this.themes;
    if (Object.keys(this.variables).length) pen.variables = this.variables;
    return { doc: pen, images: this.images, notes: [...this.notes].map(([t, n]) => (n > 1 ? `${t} (${n}×)` : t)), layers: this.layers };
  }

  // ── Variables ─────────────────────────────────────────────────────────

  private readVariables(): void {
    const taken = new Set<string>();
    const unique = (base: string) => { let name = base, i = 2; while (taken.has(name)) name = `${base}-${i++}`; taken.add(name); return name; };
    const axes = new Set<string>();
    for (const set of this.nodes.values()) {
      if (set.type !== 'VARIABLE_SET') continue;
      let axis = (set.name ?? 'Mode').trim() || 'Mode';
      for (let i = 2; axes.has(axis); i++) axis = `${set.name} ${i}`;
      axes.add(axis);
      const modes = [...(set.variableSetModes ?? [])].sort((a, b) => ((a.sortPosition ?? '') < (b.sortPosition ?? '') ? -1 : 1));
      const names: string[] = [];
      for (const m of modes) {
        let name = m.name || 'Mode';
        for (let i = 2; names.includes(name); i++) name = `${m.name} ${i}`;
        names.push(name);
        this.modes.set(key(m.id), [axis, name]);
      }
      if (names.length > 1) this.themes[axis] = names;
    }
    const vars = [...this.nodes.values()].filter((n) => n.type === 'VARIABLE');
    // Names first, so aliases between variables resolve in any order.
    for (const v of vars) this.varNames.set(key(v.guid), unique((v.name ?? 'var').trim().replace(/[\s:]+/g, '-') || 'var'));
    const TYPES: Record<string, Variable['type']> = { COLOR: 'color', FLOAT: 'number', STRING: 'string', BOOLEAN: 'boolean' };
    for (const v of vars) {
      const type = TYPES[v.variableResolvedType ?? ''];
      if (!type) { this.note(`a ${v.variableResolvedType?.toLowerCase() ?? 'kind of'} variable is not supported`); continue; }
      const entries = (v.variableDataValues?.entries ?? []).flatMap((e) => {
        const value = this.varValue(e.variableData);
        const mode = this.modes.get(key(e.modeID));
        return value === undefined ? [] : [{ value, mode }];
      });
      if (!entries.length) continue;
      const themed = entries.filter((e) => e.mode && this.themes[e.mode[0]]);
      this.variables[this.varNames.get(key(v.guid))!] = themed.length > 1
        ? { type, value: themed.map((e) => ({ value: e.value, theme: { [e.mode![0]]: e.mode![1] } })) }
        : { type, value: entries[0].value };
    }
  }

  private varValue(d: VarData | undefined): string | number | boolean | undefined {
    const v = d?.value;
    if (!v) return undefined;
    if (v.alias?.guid) { const name = this.varNames.get(key(v.alias.guid)); return name ? `$${name}` : undefined; }
    if (v.colorValue) return hex(v.colorValue);
    if (typeof v.floatValue === 'number') return r2(v.floatValue);
    if (typeof v.textValue === 'string') return v.textValue;
    if (typeof v.boolValue === 'boolean') return v.boolValue;
    return undefined;
  }

  private alias(d: VarData | undefined): string | undefined {
    const name = this.varNames.get(key(d?.value?.alias?.guid));
    return name ? `$${name}` : undefined;
  }

  // ── Nodes ─────────────────────────────────────────────────────────────

  /** Children of `parent` as .pen nodes; a mask takes the siblings above it into a clipping frame. */
  private convertChildren(parent: FigNode, stack: string | undefined): Node[] {
    const list = this.children(parent);
    const out: Node[] = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.mask && !stack) {
        const masked = list.slice(i + 1);
        const frame = this.maskFrame(c, masked, parent);
        if (frame) out.push(frame);
        break;
      }
      if (c.mask) this.note('a mask in auto layout is shown as a plain layer');
      const n = this.node(c, parent);
      if (n) out.push(n);
    }
    return out;
  }

  node(n: FigNode, parent: FigNode | undefined): Node | undefined {
    if (n.type === 'SLICE' || n.type === 'VARIABLE' || n.type === 'VARIABLE_SET') return undefined;
    if (n.type === 'INSTANCE') return this.instance(n, parent);
    const type = this.penType(n);
    if (!type) { this.note(`${n.type.toLowerCase().replaceAll('_', ' ')} layers are not supported`); return undefined; }
    this.layers++;
    if (n.type === 'SYMBOL') this.placedSymbols.add(key(n.guid));
    const out = { type, id: this.id(n.guid), ...this.props(n, parent, type) } as Rec;
    if (type === 'frame' || type === 'group') {
      const stack = type === 'frame' ? stackOf(n) : undefined;
      if (n.type === 'BOOLEAN_OPERATION') this.note('boolean operations without their result shape show their parts');
      const kids = this.convertChildren(n, stack);
      if (kids.length) out.children = stack === 'horizontal' && n.stackWrap === 'WRAP' ? this.wrapRows(n, out, kids) : kids;
    }
    return out as unknown as Node;
  }

  /**
   * .pen's auto layout does not wrap: a wrapping row becomes a column of rows, each holding the layers
   * Figma put on that line (by where it laid them out).
   */
  private wrapRows(n: FigNode, out: Rec, kids: Node[]): Node[] {
    const flow = this.children(n).filter((c) => c.stackPositioning !== 'ABSOLUTE' && c.type !== 'SLICE');
    const byId = new Map(kids.map((k) => [k.id, k]));
    const rows: Node[][] = [];
    let lineY: number | undefined;
    for (const c of [...flow].sort((a, b) => (a.transform?.m12 ?? 0) - (b.transform?.m12 ?? 0) || (a.transform?.m02 ?? 0) - (b.transform?.m02 ?? 0))) {
      const k = byId.get(this.id(c.guid));
      if (!k) continue;
      const y = c.transform?.m12 ?? 0;
      if (lineY === undefined || Math.abs(y - lineY) > 1) { rows.push([]); lineY = y; }
      rows.at(-1)!.push(k);
    }
    if (rows.length < 2) return kids;
    this.note('wrapping auto layout became a column of rows');
    const rest = kids.filter((k) => !rows.some((r) => r.includes(k)));
    out.layout = 'vertical';
    out.gap = r2(n.stackCounterSpacing ?? n.stackSpacing ?? 0);
    const justify = out.justifyContent;
    delete out.justifyContent;
    delete out.alignItems;
    return [
      ...rows.map((row, i) => ({
        type: 'frame', id: `${out.id}-row${i + 1}`, name: `Row ${i + 1}`, layout: 'horizontal', width: 'fill_container', height: 'fit_content',
        ...(n.stackSpacing ? { gap: r2(n.stackSpacing) } : {}), ...(justify ? { justifyContent: justify } : {}),
        ...(ITEMS[n.stackCounterAlignItems ?? 'MIN'] !== 'start' ? { alignItems: ITEMS[n.stackCounterAlignItems ?? 'MIN'] } : {}),
        children: row,
      }) as unknown as Node),
      ...rest,
    ];
  }

  private penType(n: FigNode): string | undefined {
    switch (n.type) {
      case 'FRAME': case 'SYMBOL': case 'SECTION': case 'COMPONENT_SET': return 'frame';
      case 'GROUP': return 'group';
      case 'RECTANGLE': case 'ROUNDED_RECTANGLE': return 'rectangle';
      case 'ELLIPSE': return 'ellipse';
      case 'TEXT': return 'text';
      case 'VECTOR': case 'STAR': case 'REGULAR_POLYGON': case 'LINE': return 'path';
      case 'BOOLEAN_OPERATION': return n.fillGeometry?.length ? 'path' : 'group';
      default: return undefined;
    }
  }

  /** A node's own .pen properties (not id, type or children), `type` being what it becomes. */
  private props(n: FigNode, parent: FigNode | undefined, type: string): Rec {
    const out: Rec = {};
    if (n.name) out.name = n.name;
    if (n.type === 'SYMBOL') out.reusable = true;
    if (n.visible === false) out.enabled = false;
    if (n.opacity !== undefined && n.opacity < 0.999) out.opacity = r2(n.opacity);
    const parentStack = parent && CONTAINERS.has(parent.type) ? stackOf(parent) : undefined;
    const absolute = n.stackPositioning === 'ABSOLUTE';
    let w = n.size?.x ?? 0, h = n.size?.y ?? 0;
    let geometry: { d: string; evenodd: boolean; stroked: boolean } | undefined;
    if (type === 'path') {
      geometry = this.geometry(n, w, h);
      if (!geometry) { this.note(`a ${n.type.toLowerCase()} without geometry is left empty`); geometry = { d: '', evenodd: false, stroked: false }; }
    }
    // A line or a flat vector has no height: give the path one so its stroke has somewhere to be.
    let shift = { x: 0, y: 0 };
    if (type === 'path' && (w < 1 || h < 1)) {
      const pw = Math.max(w, 1), ph = Math.max(h, 1);
      shift = { x: (w - pw) / 2, y: (h - ph) / 2 };
      out.viewBox = [r2(shift.x), r2(shift.y), r2(pw), r2(ph)];
      w = pw; h = ph;
    } else if (type === 'path') out.viewBox = [0, 0, r2(w), r2(h)];
    if (!parentStack || absolute) Object.assign(out, placement(n.transform, n.size?.x ?? 0, shift));
    else {
      const p = placement(n.transform, n.size?.x ?? 0, shift);
      if (p.rotation !== undefined) out.rotation = p.rotation;
      if (p.flipX) out.flipX = true;
    }
    if (absolute && parentStack) out.layoutPosition = 'absolute';

    // Size: fixed, hugging its content, or filling the parent's auto layout.
    const size: Rec = {};
    if (type !== 'group') { size.width = r2(w); size.height = r2(h); }
    const stack = type === 'frame' ? stackOf(n) : undefined;
    if (stack) {
      const [primary, counter] = stack === 'horizontal' ? ['width', 'height'] : ['height', 'width'];
      if (n.stackPrimarySizing && n.stackPrimarySizing !== 'FIXED') size[primary] = `fit_content(${size[primary]})`;
      if (n.stackCounterSizing && n.stackCounterSizing !== 'FIXED') size[counter] = `fit_content(${size[counter]})`;
    }
    if (type === 'text') {
      const growth = n.textAutoResize === 'WIDTH_AND_HEIGHT' ? 'auto' : n.textAutoResize === 'HEIGHT' ? 'fixed-width' : 'fixed-width-height';
      out.textGrowth = growth;
      if (growth === 'auto') { delete size.width; delete size.height; }
      else if (growth === 'fixed-width') delete size.height;
    }
    if (parentStack && !absolute) {
      const [primary, counter] = parentStack === 'horizontal' ? ['width', 'height'] : ['height', 'width'];
      const fill = (axis: string) => { size[axis] = `fill_container(${r2(axis === 'width' ? w : h)})`; if (type === 'text' && axis === 'width' && out.textGrowth === 'auto') out.textGrowth = 'fixed-width'; };
      if ((n.stackChildPrimaryGrow ?? 0) > 0) fill(primary);
      if (n.stackChildAlignSelf === 'STRETCH') fill(counter);
    }
    if (type !== 'group') Object.assign(out, size);

    if (type === 'frame') {
      out.layout = stack ?? 'none';
      if (stack) {
        if (n.stackSpacing) out.gap = r2(n.stackSpacing);
        const t = n.stackVerticalPadding ?? 0, l = n.stackHorizontalPadding ?? 0;
        const r = n.stackPaddingRight ?? l, b = n.stackPaddingBottom ?? t;
        if (t || r || b || l) out.padding = t === r && r === b && b === l ? r2(t) : t === b && l === r ? [r2(t), r2(r)] : [r2(t), r2(r), r2(b), r2(l)];
        const j = JUSTIFY[n.stackPrimaryAlignItems ?? 'MIN'];
        if (j && j !== 'start') out.justifyContent = j;
        const a = ITEMS[n.stackCounterAlignItems ?? 'MIN'];
        if (a && a !== 'start') out.alignItems = a;
        if (n.bordersTakeSpace) out.layoutIncludeStroke = true;
      }
      if (n.type !== 'SECTION' && n.frameMaskDisabled !== true) out.clip = true;
    }
    if (type === 'frame' || type === 'rectangle') {
      const radius = cornerRadius(n);
      if (radius !== undefined) out.cornerRadius = radius;
    }
    if (type === 'ellipse' && n.arcData && !circleArc(n)) {
      const a = n.arcData;
      const start = -((a.startingAngle ?? 0) * 180) / Math.PI, end = -((a.endingAngle ?? Math.PI * 2) * 180) / Math.PI;
      if (Math.abs(end - start) < 359.9) { out.startAngle = r2(start); out.sweepAngle = r2(end - start); }
      if (a.innerRadius) out.innerRadius = r2(a.innerRadius);
    }
    if (type === 'path' && geometry) {
      out.geometry = geometry.d;
      if (geometry.evenodd) out.fillRule = 'evenodd';
    }
    if (type === 'text') Object.assign(out, this.textProps(n));

    // Paints and effects.
    if (type !== 'group') {
      const strokeAsFill = !!geometry?.stroked;
      const fill = this.paints(strokeAsFill ? n.strokePaints : n.fillPaints);
      if (fill !== undefined) out.fill = fill;
      const stroke = strokeAsFill ? undefined : this.paints(n.strokePaints);
      if (stroke !== undefined && (n.strokeWeight ?? 1) > 0) {
        out.stroke = stroke;
        out.strokeWidth = n.borderStrokeWeightsIndependent && type !== 'path'
          ? { top: r2(n.borderTopWeight ?? 0), right: r2(n.borderRightWeight ?? 0), bottom: r2(n.borderBottomWeight ?? 0), left: r2(n.borderLeftWeight ?? 0) }
          : r2(n.strokeWeight ?? 1);
        out.strokeAlignment = ALIGN[n.strokeAlign ?? 'CENTER'] ?? 'center';
        if (n.strokeCap && CAP[n.strokeCap]) out.strokeLinecap = CAP[n.strokeCap];
        else if (n.strokeCap && n.strokeCap !== 'NONE') this.note('arrowheads and other line ends are drawn plain');
        if (n.strokeJoin && n.strokeJoin !== 'MITER' && JOIN[n.strokeJoin]) out.strokeLinejoin = JOIN[n.strokeJoin];
      }
    }
    const effects = this.effects(n.effects);
    if (effects !== undefined) out.effect = effects;

    // Variables: bound fields, and the mode a layer picks for its subtree.
    for (const map of [n.variableConsumptionMap, n.parameterConsumptionMap]) {
      for (const e of map?.entries ?? []) {
        const prop = BOUND[e.variableField ?? ''];
        const ref = this.alias(e.variableData);
        if (!prop || !ref) continue;
        if (prop === 'strokeWidth' && (typeof out.strokeWidth !== 'number')) continue;
        if (prop === 'cornerRadius' && Array.isArray(out.cornerRadius)) continue;
        if ((prop === 'width' || prop === 'height') && typeof out[prop] !== 'number') continue;
        if (prop in out || prop === 'enabled' || prop === 'cornerRadius') out[prop] = ref;
      }
    }
    const theme: Record<string, string> = {};
    for (const e of n.variableModeBySetMap?.entries ?? []) {
      const m = this.modes.get(key(e.variableModeID));
      if (m && this.themes[m[0]]) theme[m[0]] = m[1];
    }
    if (Object.keys(theme).length) out.theme = theme;
    return out;
  }

  private textProps(n: FigNode): Rec {
    const out: Rec = {};
    let content = n.textData?.characters ?? '';
    if (n.textCase === 'UPPER') content = content.toUpperCase();
    else if (n.textCase === 'LOWER') content = content.toLowerCase();
    else if (n.textCase === 'TITLE') content = content.replace(/\p{L}+/gu, (w) => w[0].toUpperCase() + w.slice(1));
    else if (n.textCase && n.textCase !== 'ORIGINAL') this.note('small caps are shown as typed');
    out.content = content;
    const style = n.fontName?.style ?? '';
    if (n.fontName?.family) out.fontFamily = n.fontName.family;
    const weight = WEIGHTS.find(([re]) => re.test(style))?.[1] ?? 400;
    if (weight !== 400) out.fontWeight = String(weight);
    if (/italic|oblique/i.test(style)) out.fontStyle = 'italic';
    const size = n.fontSize ?? 12;
    out.fontSize = r2(size);
    const ls = n.letterSpacing;
    if (ls && ls.value) out.letterSpacing = r2(ls.units === 'PERCENT' ? (ls.value / 100) * size : ls.value);
    const lh = n.lineHeight;
    // Figma's "auto" line height is 100% of the font's own; use the height it laid the text out with.
    if (lh && !(lh.units === 'PERCENT' && lh.value === 100)) out.lineHeight = r3(lh.units === 'PIXELS' ? lh.value / size : lh.units === 'PERCENT' ? lh.value / 100 : lh.value);
    else {
      const laid = n.derivedTextData?.baselines?.[0]?.lineHeight;
      if (laid) out.lineHeight = Math.round((laid / size) * 1000) / 1000;
    }
    const align = TEXT_ALIGN[n.textAlignHorizontal ?? 'LEFT'];
    if (align && align !== 'left') out.textAlign = align;
    const valign = TEXT_VALIGN[n.textAlignVertical ?? 'TOP'];
    if (valign && valign !== 'top') out.textAlignVertical = valign;
    if (n.textDecoration === 'UNDERLINE') out.underline = true;
    if (n.textDecoration === 'STRIKETHROUGH') out.strikethrough = true;
    if (n.textData?.styleOverrideTable?.length) this.note('text with mixed styles uses its first style throughout');
    return out;
  }

  private paints(list: Paint[] | undefined): unknown {
    const fills = (list ?? []).flatMap((p) => { const f = this.paint(p); return f === undefined ? [] : [f]; });
    if (!fills.length) return undefined;
    return fills.length === 1 ? fills[0] : fills;
  }

  private paint(p: Paint): unknown {
    const extra: Rec = {};
    if (p.visible === false) extra.enabled = false;
    if (p.blendMode && BLEND[p.blendMode]) extra.blendMode = BLEND[p.blendMode];
    const opacity = p.opacity ?? 1;
    switch (p.type) {
      case 'SOLID': {
        // Figma keeps a solid paint's alpha in its opacity (the color's own is 1); other tools write both.
        const color = this.alias(p.colorVar) ?? hex(p.color, Math.min(p.color?.a ?? 1, opacity));
        return Object.keys(extra).length ? { type: 'color', color, ...extra } : color;
      }
      case 'GRADIENT_LINEAR': case 'GRADIENT_RADIAL': case 'GRADIENT_ANGULAR': case 'GRADIENT_DIAMOND': {
        const g = gradient(p);
        if (p.type === 'GRADIENT_DIAMOND') this.note('diamond gradients are drawn as radial ones');
        return { type: 'gradient', ...g, ...(opacity < 0.999 ? { opacity: r2(opacity) } : {}), colors: (p.stops ?? []).map((s) => ({ color: hex(s.color), position: r2(s.position) })), ...extra };
      }
      case 'IMAGE': {
        const hash = p.image?.hash;
        const name = hash ? Buffer.from(hash).toString('hex') : '';
        const bytes = name ? this.fig.images.get(name) : undefined;
        if (!bytes) { this.note('a picture missing from the file is left out'); return undefined; }
        const file = `images/figma-${name.slice(0, 16)}.${imageExt(bytes)}`;
        this.images.set(file, bytes);
        const mode = p.imageScaleMode === 'FIT' ? 'contain' : p.imageScaleMode === 'STRETCH' ? 'stretch' : 'cover';
        if (p.imageScaleMode === 'TILE') this.note('tiled pictures are shown once, filling the layer');
        if (p.imageScaleMode === 'STRETCH' && p.transform && !isIdentity(p.transform)) this.note('cropped pictures are shown uncropped');
        return { type: 'image', url: file, mode, ...(opacity < 0.999 ? { opacity: r2(opacity) } : {}), ...extra };
      }
      default:
        this.note(`${p.type.toLowerCase().replaceAll('_', ' ')} paints are not supported`);
        return undefined;
    }
  }

  private effects(list: Effect[] | undefined): unknown {
    const out = (list ?? []).flatMap((e): Rec[] => {
      const enabled = e.visible === false ? { enabled: false } : {};
      switch (e.type) {
        case 'DROP_SHADOW': case 'INNER_SHADOW':
          return [{ type: 'shadow', ...(e.type === 'INNER_SHADOW' ? { shadowType: 'inner' } : {}), offset: { x: r2(e.offset?.x ?? 0), y: r2(e.offset?.y ?? 0) }, blur: r2(e.radius ?? 0), ...(e.spread ? { spread: r2(e.spread) } : {}), color: hex(e.color), ...(e.blendMode && BLEND[e.blendMode] ? { blendMode: BLEND[e.blendMode] } : {}), ...enabled }];
        case 'FOREGROUND_BLUR': return [{ type: 'blur', radius: r2(e.radius ?? 0), ...enabled }];
        case 'BACKGROUND_BLUR': return [{ type: 'background_blur', radius: r2(e.radius ?? 0), ...enabled }];
        default: this.note(`${e.type.toLowerCase().replaceAll('_', ' ')} effects are not supported`); return [];
      }
    });
    return out.length ? (out.length === 1 ? out[0] : out) : undefined;
  }

  private geometry(n: FigNode, w: number, h: number): { d: string; evenodd: boolean; stroked: boolean } | undefined {
    const net = n.vectorData?.vectorNetworkBlob;
    if (net !== undefined && this.blobs[net]) {
      const ns = n.vectorData?.normalizedSize ?? { x: w, y: h };
      const r = networkPath(this.blobs[net], ns.x ? w / ns.x : 1, ns.y ? h / ns.y : 1);
      if (r) return { ...r, stroked: false };
    }
    const fromBlobs = (list: Geometry[] | undefined) => {
      const parts = (list ?? []).flatMap((g) => (g.commandsBlob !== undefined && this.blobs[g.commandsBlob] ? [commandsPath(this.blobs[g.commandsBlob])] : []));
      return parts.length ? { d: parts.join(' '), evenodd: (list ?? []).some((g) => g.windingRule === 'ODD' || g.windingRule === 'EVENODD') } : undefined;
    };
    const fill = fromBlobs(n.fillGeometry);
    if (fill) return { ...fill, stroked: false };
    if (n.type === 'LINE') return { d: `M0 0 L${r2(w)} 0`, evenodd: false, stroked: false };
    if (n.type === 'REGULAR_POLYGON' || n.type === 'STAR') return { d: polygonPath(w, h, Math.max(3, n.count ?? (n.type === 'STAR' ? 5 : 3)), n.type === 'STAR' ? n.starInnerScale ?? 0.382 : undefined), evenodd: false, stroked: false };
    const stroke = fromBlobs(n.strokeGeometry);
    if (stroke) return { ...stroke, stroked: true };
    return undefined;
  }

  // ── Components ────────────────────────────────────────────────────────

  private instance(n: FigNode, parent: FigNode | undefined): Node | undefined {
    const sym = this.nodes.get(key(n.symbolData?.symbolID));
    if (!sym) {
      this.note('an instance of a component missing from the file is shown as an empty frame');
      return this.node({ ...n, type: 'FRAME' }, parent);
    }
    this.layers++;
    this.usedSymbols.add(key(sym.guid));
    const out: Rec = { type: 'ref', id: this.id(n.guid), ref: this.id(sym.guid) };
    // The instance's own properties where they differ from its component's.
    const mine = this.props({ ...sym, ...definedOf(n), type: 'FRAME' }, parent, 'frame');
    const theirs = this.props({ ...sym, type: 'FRAME' }, undefined, 'frame');
    delete mine.reusable;
    for (const [k, v] of Object.entries(mine)) if (!same(v, theirs[k]) || ['x', 'y', 'rotation', 'flipX', 'layoutPosition'].includes(k)) out[k] = v;
    const descendants: Record<string, Rec> = {};
    for (const o of n.symbolData?.symbolOverrides ?? []) {
      const path = (o.guidPath?.guids ?? []).map((g) => this.id(g));
      const target = this.resolvePath(sym, o.guidPath?.guids ?? []);
      if (!path.length || !target) continue;
      const k = path.join('/');
      if (o.overriddenSymbolID) {
        const swap = this.nodes.get(key(o.overriddenSymbolID));
        if (swap) {
          this.usedSymbols.add(key(swap.guid));
          descendants[k] = { ...(descendants[k] ?? {}), type: 'ref', id: path.at(-1)!, ref: this.id(swap.guid), ...pick(this.props(target.node, target.parent, 'frame'), ['x', 'y', 'width', 'height', 'rotation']) };
          continue;
        }
      }
      const type = target.node.type === 'INSTANCE' ? 'frame' : this.penType(target.node);
      if (!type) continue;
      const before = this.props(target.node, target.parent, type);
      const after = this.props({ ...target.node, ...definedOf(o) }, target.parent, type);
      const entry: Rec = {};
      for (const [p, v] of Object.entries(after)) if (!same(v, before[p])) entry[p] = v;
      for (const p of Object.keys(before)) if (!(p in after)) entry[p] = p === 'enabled' ? true : undefined;
      for (const p of Object.keys(entry)) if (entry[p] === undefined) delete entry[p];
      if (Object.keys(entry).length) descendants[k] = { ...(descendants[k] ?? {}), ...entry };
    }
    // Where Figma resized the instance, the size and place it gave each layer not in auto layout.
    if (!same(n.size, sym.size)) {
      for (const d of n.derivedSymbolData ?? []) {
        const path = (d.guidPath?.guids ?? []).map((g) => this.id(g));
        const target = this.resolvePath(sym, d.guidPath?.guids ?? []);
        if (!path.length || !target || (target.parent && stackOf(target.parent))) continue;
        const entry: Rec = {};
        if (d.size && !same(d.size, target.node.size)) { entry.width = r2(d.size.x); entry.height = r2(d.size.y); }
        if (d.transform && !same(d.transform, target.node.transform)) Object.assign(entry, placement(d.transform, d.size?.x ?? target.node.size?.x ?? 0, { x: 0, y: 0 }));
        if (Object.keys(entry).length) descendants[path.join('/')] = { ...(descendants[path.join('/')] ?? {}), ...entry };
      }
    }
    if (Object.keys(descendants).length) out.descendants = descendants;
    return out as unknown as Node;
  }

  /** The layer a guid path names inside `sym`, through nested instances, with its parent. */
  private resolvePath(sym: FigNode, guids: Guid[]): { node: FigNode; parent: FigNode | undefined } | undefined {
    let scope = sym;
    let found: { node: FigNode; parent: FigNode | undefined } | undefined;
    for (const [i, g] of guids.entries()) {
      found = this.findIn(scope, key(g));
      if (!found) return undefined;
      if (i < guids.length - 1) {
        if (found.node.type !== 'INSTANCE') return undefined;
        const inner = this.nodes.get(key(found.node.symbolData?.symbolID));
        if (!inner) return undefined;
        scope = inner;
      }
    }
    return found;
  }

  private findIn(root: FigNode, k: string): { node: FigNode; parent: FigNode } | undefined {
    for (const c of this.children(root)) {
      if (key(c.guid) === k) return { node: c, parent: root };
      const deeper = this.findIn(c, k);
      if (deeper) return deeper;
    }
    return undefined;
  }

  // ── Masks ─────────────────────────────────────────────────────────────

  /** A Figma mask and the layers above it: a frame clipping them to the mask's shape, as nib's own masks are. */
  private maskFrame(mask: FigNode, masked: FigNode[], parent: FigNode): Node | undefined {
    const type = this.penType(mask);
    if (!type) return undefined;
    const shape = { type, id: this.id(mask.guid), ...this.props({ ...mask, mask: false }, parent, type) } as Rec;
    const w = mask.size?.x ?? 0, h = mask.size?.y ?? 0;
    const circle = mask.type === 'ELLIPSE' && Math.abs(w - h) < 0.5 && !mask.arcData?.innerRadius;
    const rect = mask.type === 'RECTANGLE' || mask.type === 'ROUNDED_RECTANGLE' || mask.type === 'FRAME';
    if (!rect && !circle) this.note('a mask that is not a rectangle or a circle clips to its bounding box');
    const t = mask.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
    if (Math.abs(t.m01) > 1e-3 || Math.abs(t.m10) > 1e-3) this.note('a rotated mask clips without its rotation');
    const x = t.m02, y = t.m12;
    const children: Node[] = [];
    for (const m of masked) {
      const node = this.node(m, parent);
      if (!node) continue;
      node.x = r2((node.x ?? 0) - x);
      node.y = r2((node.y ?? 0) - y);
      children.push(node);
    }
    this.layers++;
    const radius = circle ? r2(w / 2) : rect ? cornerRadius(mask) : undefined;
    return {
      type: 'frame', id: `${this.id(mask.guid)}-mask`, name: mask.name ?? 'Mask', x: r2(x), y: r2(y), width: r2(w), height: r2(h),
      ...(radius !== undefined ? { cornerRadius: radius } : {}), clip: true, layout: 'none',
      metadata: { type: 'nib-mask', mask: shape }, children,
    } as unknown as Node;
  }
}

function stackOf(n: FigNode): 'horizontal' | 'vertical' | undefined {
  return n.stackMode === 'HORIZONTAL' ? 'horizontal' : n.stackMode === 'VERTICAL' ? 'vertical' : undefined;
}

function circleArc(n: FigNode): boolean {
  const a = n.arcData;
  if (!a) return true;
  const sweep = Math.abs((a.endingAngle ?? Math.PI * 2) - (a.startingAngle ?? 0));
  return sweep >= Math.PI * 2 - 1e-3 && !a.innerRadius;
}

function cornerRadius(n: FigNode): number | number[] | undefined {
  if (n.rectangleCornerRadiiIndependent) {
    const r = [n.rectangleTopLeftCornerRadius, n.rectangleTopRightCornerRadius, n.rectangleBottomRightCornerRadius, n.rectangleBottomLeftCornerRadius].map((v) => r2(v ?? 0));
    if (r.some((v) => v)) return r.every((v) => v === r[0]) ? r[0] : r;
    return undefined;
  }
  return n.cornerRadius ? r2(n.cornerRadius) : undefined;
}

/**
 * x, y, rotation and flip from Figma's transform (local to parent). .pen rotates counter-clockwise around
 * the top-left corner and mirrors within the box, so a mirrored layer's corner is where its local x = w lands.
 * `shift` moves the box's origin in the layer's own space (paths padded to a minimum size).
 */
function placement(t: Matrix | undefined, w: number, shift: Vec): { x: number; y: number; rotation?: number; flipX?: boolean } {
  if (!t) return { x: 0, y: 0 };
  let a = t.m00, b = t.m10;
  const c = t.m01, d = t.m11;
  let x = t.m02 + a * shift.x + c * shift.y, y = t.m12 + b * shift.x + d * shift.y;
  const flip = a * d - b * c < 0;
  if (flip) { x += a * w; y += b * w; a = -a; b = -b; }
  const rotation = r2((Math.atan2(-b, a) * 180) / Math.PI);
  return { x: r2(x), y: r2(y), ...(Math.abs(rotation) > 0.01 ? { rotation } : {}), ...(flip ? { flipX: true } : {}) };
}

/**
 * A Figma gradient as .pen's: Figma's transform maps the layer's unit square to gradient space, where a
 * linear gradient runs from (0, .5) to (1, .5) and radial and angular ones fill the circle around (.5, .5).
 */
function gradient(p: Paint): Rec {
  const t = p.transform ?? { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 };
  const det = t.m00 * t.m11 - t.m01 * t.m10 || 1e-9;
  // The inverse: gradient space back to the layer's unit square.
  const ia = t.m11 / det, ib = -t.m10 / det, ic = -t.m01 / det, id = t.m00 / det;
  const ix = (t.m01 * t.m12 - t.m11 * t.m02) / det, iy = (t.m10 * t.m02 - t.m00 * t.m12) / det;
  const at = (x: number, y: number) => ({ x: ia * x + ic * y + ix, y: ib * x + id * y + iy });
  const deg = (r: number) => r2((r * 180) / Math.PI);
  if (p.type === 'GRADIENT_LINEAR') {
    const s = at(0, 0.5), e = at(1, 0.5);
    const vx = e.x - s.x, vy = e.y - s.y;
    return { gradientType: 'linear', center: { x: r2((s.x + e.x) / 2), y: r2((s.y + e.y) / 2) }, size: { height: r2(Math.hypot(vx, vy)) }, rotation: deg(Math.atan2(-vx, -vy)) };
  }
  const c = at(0.5, 0.5);
  const col1 = { x: ia, y: ib }, col2 = { x: ic, y: id };
  const theta = Math.atan2(-col1.y, col1.x);
  if (p.type === 'GRADIENT_ANGULAR') {
    // .pen's angular gradient starts pointing up, Figma's along the gradient's x axis.
    return { gradientType: 'angular', center: { x: r2(c.x), y: r2(c.y) }, size: { width: r2(Math.hypot(col2.x, col2.y)), height: r2(Math.hypot(col1.x, col1.y)) }, rotation: deg(theta - Math.PI / 2) };
  }
  return { gradientType: 'radial', center: { x: r2(c.x), y: r2(c.y) }, size: { width: r2(Math.hypot(col1.x, col1.y)), height: r2(Math.hypot(col2.x, col2.y)) }, rotation: deg(theta) };
}

function polygonPath(w: number, h: number, count: number, inner: number | undefined): string {
  const points: string[] = [];
  const steps = inner === undefined ? count : count * 2;
  for (let i = 0; i < steps; i++) {
    const r = inner !== undefined && i % 2 ? inner : 1;
    const a = -Math.PI / 2 + (i * Math.PI * 2) / steps;
    points.push(`${r2(w / 2 + (Math.cos(a) * r * w) / 2)} ${r2(h / 2 + (Math.sin(a) * r * h) / 2)}`);
  }
  return `M${points.join(' L')} Z`;
}

function imageExt(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49) return 'gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57) return 'webp';
  if (b[0] === 0x3c) return 'svg';
  return 'png';
}

const isIdentity = (t: Matrix) => Math.abs(t.m00 - 1) < 1e-6 && Math.abs(t.m11 - 1) < 1e-6 && Math.abs(t.m01) < 1e-6 && Math.abs(t.m10) < 1e-6 && Math.abs(t.m02) < 1e-6 && Math.abs(t.m12) < 1e-6;
const pick = (r: Rec, keys: string[]) => Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
/** An override's or instance's fields that say something (not its identity or place in the tree). */
function definedOf(o: Partial<FigNode>): Partial<FigNode> {
  const { guid: _g, guidPath: _p, parentIndex: _i, type: _t, phase: _ph, symbolData: _s, derivedSymbolData: _d, ...rest } = o as Override;
  return Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined)) as Partial<FigNode>;
}

/** The box around top-level nodes, from their x, y and fixed sizes. */
function bounds(nodes: Node[]): { x: number; y: number; width: number; height: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const n of nodes) {
    const w = sizeOf((n as Rec).width), h = sizeOf((n as Rec).height);
    x0 = Math.min(x0, n.x ?? 0); y0 = Math.min(y0, n.y ?? 0);
    x1 = Math.max(x1, (n.x ?? 0) + w); y1 = Math.max(y1, (n.y ?? 0) + h);
  }
  return Number.isFinite(x0) ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : { x: 0, y: 0, width: 0, height: 0 };
}

function sizeOf(v: unknown): number {
  if (typeof v === 'number') return v;
  const m = typeof v === 'string' ? /\((-?[\d.]+)\)/.exec(v) : null;
  return m ? Number(m[1]) : 0;
}
