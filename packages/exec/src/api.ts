import { NODE_SPECS, validateNode, type Issue, type Node, type NodeType, type RefNode, type Variable } from '@nib/format';
import {
  buildScene, childrenOf, defaultTheme, expandTree, inheritedTheme, reassignIds, resolveDeep, withTheme,
  type DocEditor, type PenDoc, type SceneNode, type ThemeContext,
} from '@nib/core';
import type { Box } from '@nib/layout';
import { problemOf, type BoundsCache, type ClipProblem } from './bounds.ts';
import { ExecError } from './errors.ts';
import { componentDescendant, componentRoot, DOCUMENT, findById, normalizeDescendantKeys, resolve, type Target } from './targets.ts';

type Props = Record<string, unknown>;
type Inside = Extract<Target, { kind: 'inside' }>;

export interface GetOptions {
  /** Levels of children to include; deeper ones read `"..."`. Default: all (one level of top-level nodes for `document`). */
  depth?: number;
  resolveVariables?: boolean;
  resolveInstances?: boolean;
  includePathGeometry?: boolean;
}

/** One node of a subtree handed to a `Get` visitor: the node (shallow), its box and problem, its children. */
export interface TreeEntry {
  n: Props;
  b: Box;
  p?: ClipProblem;
  c?: TreeEntry[];
}

export const EXPORT_FORMATS = ['png', 'jpeg', 'webp', 'pdf', 'html-tailwind', 'html-css'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportOptions {
  scale?: number;
  quality?: number;
  includeHtmlScaffold?: boolean;
  includeLayerNames?: boolean;
  includeLayerIds?: boolean;
}

/** A node as it looked when captured: the scene of its top-level node, and the node in it. */
export interface CapturedScene {
  id: string;
  root: SceneNode;
  target: SceneNode;
}

export type Capture =
  | { kind: 'screenshot'; scenes: CapturedScene[] }
  | { kind: 'export'; scenes: CapturedScene[]; format: ExportFormat; outputPath: string; options: ExportOptions };

export interface ApiOutput {
  prints: string[];
  /** Nodes the snippet created, in creation order. */
  created: { id: string; name: string }[];
  captures: Capture[];
  warnings: string[];
}

const CONTAINERS = new Set<NodeType>(['frame', 'group']);
const VARIABLE_TYPES = new Set(['boolean', 'color', 'number', 'string']);
const COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const isObject = (v: unknown): v is Props => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The functions an `execute` snippet calls, working on one document through a `DocEditor`, so that the
 * session can commit or roll back everything a snippet did. Arguments arrive as plain JSON.
 */
export class PenApi {
  readonly out: ApiOutput = { prints: [], created: [], captures: [], warnings: [] };
  private doc: PenDoc;
  private editor: DocEditor;
  private bounds: BoundsCache;

  constructor(doc: PenDoc, editor: DocEditor, bounds: BoundsCache) {
    this.doc = doc;
    this.editor = editor;
    this.bounds = bounds;
  }

  // Mutations

  insert(parent: unknown, data: unknown): string {
    const node = this.prepareNew(data, 'Insert');
    const id = this.place(parent, node, undefined, 'Insert');
    this.noteCreated(node, true, id);
    return id;
  }

  copy(path: unknown, parent: unknown, data?: unknown): string {
    if (data !== undefined && !isObject(data)) throw new ExecError('Copy: the third argument must be an object of properties');
    const t = resolve(this.doc, path as string);
    const changes = { ...(data ?? {}) };
    for (const k of ['id', 'type']) if (k in changes) throw new ExecError(`Copy: "${k}" of a copy cannot be set`);
    let node: Node;
    if (t.kind === 'node' && t.node.reusable) {
      // Copying a component makes an instance of it.
      node = { type: 'ref', ref: t.node.id, id: '' } as RefNode;
      if (t.node.x !== undefined) node.x = t.node.x;
      if (t.node.y !== undefined) node.y = t.node.y;
    } else {
      const source = t.kind === 'node' ? t.node : t.expanded;
      node = structuredClone(source);
    }
    const map = reassignIds(this.doc, node);
    const descendants = changes.descendants;
    delete changes.descendants;
    if (descendants !== undefined) {
      if (!isObject(descendants)) throw new ExecError('Copy: descendants must be an object keyed by descendant id or name');
      if (node.type === 'ref') changes.descendants = descendants;
      else this.applyToCopy(node, descendants, map);
    }
    if ('children' in changes) {
      if (!CONTAINERS.has(node.type)) throw new ExecError(`Copy: a ${node.type} has no children`);
      const kids = changes.children;
      if (!Array.isArray(kids)) throw new ExecError('Copy: children must be an array of nodes');
      changes.children = kids.map((k) => this.prepareNew(k, 'Copy'));
    }
    if (Object.keys(changes).length) this.mergeInto(node, changes, 'Copy');
    const id = this.place(parent, node, undefined, 'Copy');
    this.noteCreated(node, false, id);
    return id;
  }

  update(path: unknown, data: unknown): void {
    if (!isObject(data)) throw new ExecError('Update: the second argument must be an object of properties');
    for (const k of ['id', 'type', 'children']) {
      if (k in data) throw new ExecError(`Update: "${k}" cannot be changed; ${k === 'children' ? 'use Insert, Move and Delete' : 'use Replace'}`);
    }
    const t = this.mutable(path, 'Update');
    if (t.kind === 'inside') return this.writeOverride(t, data);
    const node = t.node;
    const next = structuredClone(node) as Props;
    this.mergeInto(next as unknown as Node, structuredClone(data), 'Update');
    const props: Props = {};
    for (const k of Object.keys(data)) props[k] = next[k];
    if (node.reusable && data.reusable === false) this.warnInstances(node.id, 'is no longer a component');
    this.editor.set(node.id, props);
    this.changed();
  }

  replace(path: unknown, data: unknown): string {
    const t = this.mutable(path, 'Replace');
    const node = this.prepareNew(data, 'Replace');
    if (t.kind === 'inside') {
      const desc = { ...(t.ref.descendants ?? {}) };
      desc[this.replacementKey(desc, t.key) ?? t.key] = node as unknown as Props;
      this.editor.set(t.ref.id, { descendants: desc });
      this.changed();
      const id = [...t.path.split('/').slice(0, -1), node.id].join('/');
      this.noteCreated(node, true, id);
      return id;
    }
    const at = this.doc.locate(t.node.id)!;
    if (t.node.reusable) this.warnInstances(t.node.id, 'was replaced');
    this.editor.remove(t.node.id);
    this.editor.insert(at.parent, node, at.index);
    this.changed();
    this.noteCreated(node, true, node.id);
    return node.id;
  }

  move(path: unknown, parent: unknown, index?: unknown): void {
    const t = this.mutable(path, 'Move');
    if (t.kind === 'inside') throw new ExecError('Move: nodes inside an instance cannot be moved; change the component, or Replace the node');
    if (index !== undefined && index !== null && (typeof index !== 'number' || !Number.isInteger(index))) throw new ExecError('Move: index must be an integer');
    const at = this.doc.locate(t.node.id)!;
    let target: Node | null;
    if (parent === undefined || parent === null) target = at.parent;
    else if (parent === DOCUMENT) target = null;
    else {
      const p = resolve(this.doc, parent as string);
      if (p.kind === 'inside') throw new ExecError('Move: nodes cannot be moved into an instance; use Insert or Copy with an instance path');
      target = p.node;
      if (!CONTAINERS.has(target.type)) throw new ExecError(`Move: "${target.id}" is a ${target.type}; only frames and groups have children`);
      if (target === t.node || this.doc.ancestors(target.id).includes(t.node)) throw new ExecError(`Move: "${target.id}" is inside "${t.node.id}"`);
    }
    this.editor.move(t.node.id, target, (index as number | undefined) ?? undefined);
    this.changed();
  }

  delete(path: unknown): void {
    const t = this.mutable(path, 'Delete');
    if (t.kind === 'inside') throw new ExecError(`Delete: "${t.path}" is inside an instance; hide it with Update("${t.path}", {enabled: false})`);
    if (t.node.reusable) this.warnInstances(t.node.id, 'was deleted');
    this.editor.remove(t.node.id);
    this.changed();
  }

  setVariables(vars: unknown, replace?: unknown): void {
    if (!isObject(vars)) throw new ExecError('SetVariables: expected an object of variable name -> {type, value}');
    const themes = structuredClone(this.doc.data.themes ?? {});
    let themesChanged = false;
    for (const [name, v] of Object.entries(vars)) {
      checkVariable(name, v);
      for (const entry of Array.isArray((v as Variable).value) ? (v as { value: { theme?: Props }[] }).value : []) {
        for (const [axis, value] of Object.entries(entry.theme ?? {})) {
          const values = (themes[axis] ??= []);
          if (!values.includes(value as string)) { values.push(value as string); themesChanged = true; }
        }
      }
    }
    const variables = replace === true ? (vars as Record<string, Variable>) : { ...(this.doc.data.variables ?? {}), ...(vars as Record<string, Variable>) };
    this.editor.setVariables(variables, themesChanged ? themes : undefined);
    this.changed();
  }

  generate(): never {
    throw new ExecError('Generate is not available in this version of nib');
  }

  // Reading

  getVariables(): { variables: Record<string, Variable>; themes?: Record<string, string[]> } {
    const { variables, themes } = this.doc.data;
    return { variables: variables ?? {}, ...(themes ? { themes } : {}) };
  }

  get(path: unknown, opts: GetOptions = {}): Props {
    const o = checkGetOptions(opts);
    if (path === DOCUMENT) {
      const ctx = defaultTheme(this.doc.data);
      return { children: this.doc.data.children.map((n) => this.serialize(n, o.depth ?? 0, o, ctx)) };
    }
    const t = resolve(this.doc, path as string);
    const node = t.kind === 'node' ? t.node : t.expanded;
    return this.serialize(node, o.depth ?? Infinity, o, inheritedTheme(this.doc, t.kind === 'node' ? node.id : t.ref.id));
  }

  /** The subtree a visitor walks: every top-level node for `null`/`document`, else the node at `path`. */
  tree(path: unknown, opts: GetOptions = {}): TreeEntry[] {
    const o = checkGetOptions(opts);
    if (path === null || path === undefined || path === DOCUMENT) {
      const ctx = defaultTheme(this.doc.data);
      return this.doc.data.children.map((n) => this.entry(n, undefined, o, ctx));
    }
    const t = resolve(this.doc, path as string);
    if (t.kind === 'inside') {
      const parentPath = t.path.split('/').slice(0, -1).join('/');
      return [this.entry(t.expanded, this.bounds.box(parentPath), o, inheritedTheme(this.doc, t.ref.id))];
    }
    const parent = this.doc.locate(t.node.id)?.parent;
    return [this.entry(t.node, parent ? this.bounds.box(parent.id) : undefined, o, inheritedTheme(this.doc, t.node.id))];
  }

  findEmptySpace(input: unknown): { x: number; y: number; parentId?: string } {
    if (!isObject(input)) throw new ExecError('FindEmptySpace: expected {width, height, direction?, padding?, nodeId?}');
    const { width, height } = input;
    const direction = input.direction ?? 'right';
    const padding = input.padding ?? 0;
    if (typeof width !== 'number' || typeof height !== 'number' || width < 0 || height < 0) throw new ExecError('FindEmptySpace: width and height must be non-negative numbers');
    if (!['top', 'right', 'bottom', 'left'].includes(direction as string)) throw new ExecError('FindEmptySpace: direction must be "top", "right", "bottom" or "left"');
    if (typeof padding !== 'number') throw new ExecError('FindEmptySpace: padding must be a number');
    let parentId: string | undefined;
    let siblings: Node[];
    let anchor: Box | undefined;
    if (input.nodeId !== undefined) {
      const at = typeof input.nodeId === 'string' ? this.doc.locate(input.nodeId) : undefined;
      if (!at) throw new ExecError(`FindEmptySpace: node ${JSON.stringify(input.nodeId)} not found`);
      parentId = at.parent?.id;
      siblings = this.doc.siblings(at.parent);
      anchor = this.bounds.box(at.node.id);
    } else {
      siblings = this.doc.data.children;
      anchor = union(siblings.map((n) => this.bounds.box(n.id)).filter((b): b is Box => !!b));
    }
    const boxes = siblings.map((n) => this.bounds.box(n.id)).filter((b): b is Box => !!b && b.width + b.height > 0);
    if (!anchor) return { x: 0, y: 0, ...(parentId ? { parentId } : {}) };
    const c: Box = { x: anchor.x, y: anchor.y, width, height };
    if (direction === 'right') c.x = anchor.x + anchor.width + padding;
    if (direction === 'left') c.x = anchor.x - padding - width;
    if (direction === 'bottom') c.y = anchor.y + anchor.height + padding;
    if (direction === 'top') c.y = anchor.y - padding - height;
    for (let i = 0; i <= boxes.length; i++) {
      const hit = boxes.find((b) => c.x < b.x + b.width + padding && c.x + c.width + padding > b.x && c.y < b.y + b.height + padding && c.y + c.height + padding > b.y);
      if (!hit) break;
      if (direction === 'right') c.x = hit.x + hit.width + padding;
      if (direction === 'left') c.x = hit.x - padding - width;
      if (direction === 'bottom') c.y = hit.y + hit.height + padding;
      if (direction === 'top') c.y = hit.y - padding - height;
    }
    return { x: Math.round(c.x), y: Math.round(c.y), ...(parentId ? { parentId } : {}) };
  }

  print(line: string): void {
    this.out.prints.push(line);
  }

  takeScreenshot(ids: unknown): void {
    this.out.captures.push({ kind: 'screenshot', scenes: this.captureAll(ids, 'TakeScreenshot') });
  }

  export(ids: unknown, format: unknown, outputPath: unknown, options?: unknown): void {
    if (!EXPORT_FORMATS.includes(format as ExportFormat)) throw new ExecError(`Export: format must be one of ${EXPORT_FORMATS.map((f) => `"${f}"`).join(', ')}`);
    if (typeof outputPath !== 'string' || !outputPath) throw new ExecError('Export: outputPath must be a path string (a directory for images, a file for pdf and html)');
    if (options !== undefined && !isObject(options)) throw new ExecError('Export: options must be an object');
    const o = (options ?? {}) as ExportOptions;
    if (o.scale !== undefined && (typeof o.scale !== 'number' || o.scale <= 0)) throw new ExecError('Export: scale must be a positive number');
    if (o.quality !== undefined && (typeof o.quality !== 'number' || o.quality < 1 || o.quality > 100)) throw new ExecError('Export: quality must be 1-100');
    this.out.captures.push({ kind: 'export', scenes: this.captureAll(ids, 'Export'), format: format as ExportFormat, outputPath, options: o });
  }

  // Helpers

  private changed(): void {
    this.bounds.invalidate();
  }

  /** Resolve a path for a mutation; nodes of imported documents are read-only here. */
  private mutable(path: unknown, fn: string): Target {
    if (typeof path === 'string' && path.split('/')[0].includes(':')) throw new ExecError(`${fn}: "${path}" belongs to an imported document; open that document to change it`);
    return resolve(this.doc, path as string);
  }

  /** Validate a new node from a snippet and give its subtree fresh ids. */
  private prepareNew(data: unknown, fn: string): Node {
    if (!isObject(data)) throw new ExecError(`${fn}: expected a node object like {type: "frame", ...}`);
    const node = structuredClone(data) as unknown as Node;
    const strip = (n: Props) => { delete n.id; for (const c of (Array.isArray(n.children) ? n.children : [])) if (isObject(c)) strip(c); };
    strip(node as unknown as Props);
    this.check(validateNode(node, { strict: true }), fn);
    const refs = (n: Node) => { if (n.type === 'ref') this.prepareRef(n as RefNode, fn); childrenOf(n)?.forEach(refs); };
    refs(node);
    reassignIds(this.doc, node);
    return node;
  }

  /** Check an instance's target and overrides; give replacement subtrees ids. */
  private prepareRef(ref: RefNode, fn: string): void {
    const comp = this.doc.get(ref.ref);
    if (!comp) throw new ExecError(`${fn}: component "${ref.ref}" not found`);
    if (!comp.reusable) throw new ExecError(`${fn}: "${ref.ref}" is not a component; make it one with Update("${ref.ref}", {reusable: true}) first`);
    if ('children' in ref) throw new ExecError(`${fn}: an instance gets its children from its component; change them through descendants`);
    const root = componentRoot(this.doc, comp);
    const own = NODE_SPECS.ref;
    const rootProps: Props = {};
    for (const [k, v] of Object.entries(ref)) if (!(k in own)) rootProps[k] = v;
    if (root) this.checkProps(root.type, rootProps, ref.name ? `"${ref.name}"` : '(instance)', fn);
    if (ref.descendants) ref.descendants = this.prepareDescendants(comp, ref.descendants, fn);
  }

  private prepareDescendants(comp: Node, descendants: Props, fn: string): Record<string, Props> {
    const out = normalizeDescendantKeys(this.doc, comp.id, descendants);
    // An entry for a nested instance may carry that instance's own `descendants`; they become path keys,
    // prepared against the nested instance's component.
    const nestedOut: Record<string, Props> = {};
    for (const [key, entry] of Object.entries(out)) {
      if ('type' in entry || entry.descendants === undefined) continue;
      const { descendants: nested, ...props } = entry;
      const inner = this.doc.get(key.split('/').pop()!);
      if (inner?.type !== 'ref' || !isObject(nested)) throw new ExecError(`${fn}: descendants["${key}"] is not a component instance, so it cannot have descendants`);
      const innerComp = this.doc.get((inner as RefNode).ref);
      if (!innerComp) throw new ExecError(`${fn}: component "${(inner as RefNode).ref}" not found`);
      if (Object.keys(props).length) out[key] = props;
      else delete out[key];
      for (const [k, v] of Object.entries(this.prepareDescendants(innerComp, nested, fn))) nestedOut[`${key}/${k}`] = v;
    }
    for (const [key, entry] of Object.entries(out)) {
      const target = componentDescendant(this.doc, comp, key);
      if ('type' in entry) {
        out[key] = this.prepareNew(entry, fn) as unknown as Props;
      } else if (target) {
        const { children, ...props } = entry;
        this.checkProps(target.type, props, `descendants["${key}"]`, fn);
        if (children !== undefined) {
          if (!CONTAINERS.has(target.type)) throw new ExecError(`${fn}: descendants["${key}"] is a ${target.type} and has no children`);
          if (!Array.isArray(children)) throw new ExecError(`${fn}: descendants["${key}"].children must be an array of nodes`);
          out[key] = { ...props, children: children.map((c) => this.prepareNew(c, fn)) };
        }
      }
    }
    for (const [k, v] of Object.entries(nestedOut)) {
      out[k] = out[k] && !('type' in v) && !('type' in out[k]) ? { ...out[k], ...v } : v;
    }
    return out;
  }

  /** Validate properties against a node type's schema, as `execute` input (unknown properties are errors). */
  private checkProps(type: NodeType, props: Props, where: string, fn: string): void {
    const spec = NODE_SPECS[type];
    const issues: Issue[] = [];
    for (const [k, v] of Object.entries(props)) {
      const c = spec[k];
      if (!c) { issues.push({ level: 'error', path: `${where}.${k}`, message: `"${k}" is not a property of ${type} nodes` }); continue; }
      const e = c(v);
      if (e) issues.push({ level: 'error', path: `${where}.${k}`, message: e });
    }
    this.check(issues, fn);
  }

  private check(issues: Issue[], fn: string): void {
    const errors = issues.filter((i) => i.level === 'error');
    if (errors.length) throw new ExecError(`${fn}: invalid properties:\n${errors.map((e) => ` - ${e.path}: ${e.message}`).join('\n')}`);
    for (const w of issues) this.out.warnings.push(`${w.path}: ${w.message}`);
  }

  /**
   * Merge `changes` into `node` (a detached copy), validating what changed. For instances, root overrides
   * are checked against the component root and `descendants` entries merge key by key.
   */
  private mergeInto(node: Node, changes: Props, fn: string): void {
    const target = node as unknown as Props;
    if (node.type === 'ref') {
      const ref = node as RefNode;
      if ('ref' in changes) {
        const comp = typeof changes.ref === 'string' ? this.doc.get(changes.ref) : undefined;
        if (!comp?.reusable) throw new ExecError(`${fn}: ref must be the id of a component, got ${JSON.stringify(changes.ref)}`);
      }
      const { descendants, ...rest } = changes;
      const own = NODE_SPECS.ref;
      const comp = this.doc.get(typeof rest.ref === 'string' ? rest.ref : ref.ref);
      const root = comp && componentRoot(this.doc, comp);
      const rootProps = Object.fromEntries(Object.entries(rest).filter(([k]) => !(k in own)));
      if (root) this.checkProps(root.type, rootProps, node.name ? `"${node.name}"` : node.id, fn);
      this.checkProps('ref', Object.fromEntries(Object.entries(rest).filter(([k]) => k in own)), node.name ? `"${node.name}"` : node.id, fn);
      Object.assign(target, rest);
      if (descendants !== undefined) {
        if (!isObject(descendants)) throw new ExecError(`${fn}: descendants must be an object keyed by descendant id or name`);
        if (!comp) throw new ExecError(`${fn}: component "${ref.ref}" not found`);
        const merged = { ...(ref.descendants ?? {}) };
        for (const [k, v] of Object.entries(this.prepareDescendants(comp, descendants, fn))) {
          merged[k] = 'type' in v || !merged[k] || 'type' in merged[k] ? v : { ...merged[k], ...v };
        }
        ref.descendants = merged;
      }
      return;
    }
    // Only report problems the change introduces: stored nodes may already carry properties outside the schema.
    const old = validateNode(node, { strict: true, deep: false });
    const known = new Set(old.map((i) => `${i.path}|${i.message}`));
    Object.assign(target, changes);
    const issues = validateNode(node, { strict: true, deep: false }).filter((i) => !known.has(`${i.path}|${i.message}`));
    this.check(issues, fn);
    if (Array.isArray(changes.children)) for (const c of changes.children as Node[]) this.check(validateNode(c, { strict: true }), fn);
  }

  /** Apply Copy's `descendants` to a plain copy: keys are ids in the source (or unique names). */
  private applyToCopy(copy: Node, descendants: Props, map: Map<string, string>): void {
    for (const [key, entry] of Object.entries(descendants)) {
      if (!isObject(entry)) throw new ExecError(`Copy: descendants["${key}"] must be an object`);
      if (key.includes('/')) {
        // A path into an instance inside the copy: override that instance.
        const [first, ...rest] = key.split('/');
        const inst = findById(copy, map.get(first) ?? first);
        if (inst?.type !== 'ref') throw new ExecError(`Copy: descendants["${key}"]: "${first}" is not a component instance in the copied node`);
        const comp = this.doc.get((inst as RefNode).ref);
        if (!comp) throw new ExecError(`Copy: component "${(inst as RefNode).ref}" not found`);
        const merged = { ...((inst as RefNode).descendants ?? {}) };
        for (const [k, v] of Object.entries(this.prepareDescendants(comp, { [rest.join('/')]: entry }, 'Copy'))) {
          merged[k] = 'type' in v || !merged[k] || 'type' in merged[k] ? v : { ...merged[k], ...v };
        }
        (inst as RefNode).descendants = merged;
        continue;
      }
      let id = map.get(key) ?? key;
      let hit = findById(copy, id);
      if (!hit) {
        const named: Node[] = [];
        const visit = (n: Node) => { if (n !== copy && n.name === key) named.push(n); childrenOf(n)?.forEach(visit); };
        visit(copy);
        if (named.length > 1) throw new ExecError(`Copy: several descendants are named "${key}"; use the id`);
        hit = named[0];
      }
      if (!hit) throw new ExecError(`Copy: the copied node has no descendant "${key}"`);
      id = hit.id;
      if ('type' in entry) {
        const fresh = this.prepareNew(entry, 'Copy');
        const parent = findParent(copy, hit)!;
        const siblings = childrenOf(parent)!;
        siblings[siblings.indexOf(hit)] = fresh;
      } else {
        if ('id' in entry || 'children' in entry) throw new ExecError(`Copy: descendants["${key}"] cannot set id or children`);
        this.mergeInto(hit, structuredClone(entry), 'Copy');
      }
    }
  }

  /** Insert a prepared node under `parent` (an id, an instance path, or `document`); returns its path. */
  private place(parent: unknown, node: Node, index: number | undefined, fn: string): string {
    if (parent === DOCUMENT) {
      this.editor.insert(null, node, index);
      this.changed();
      return node.id;
    }
    const t = this.mutable(parent, fn);
    if (t.kind === 'node') {
      if (t.node.type === 'ref') throw new ExecError(`${fn}: "${t.node.id}" is a component instance; insert into one of its frames with an instance path ("${t.node.id}/childId")`);
      if (!CONTAINERS.has(t.node.type)) throw new ExecError(`${fn}: "${t.node.id}" is a ${t.node.type}; only frames and groups have children`);
      this.editor.insert(t.node, node, index);
      this.changed();
      return node.id;
    }
    if (!CONTAINERS.has(t.expanded.type)) throw new ExecError(`${fn}: "${t.path}" is a ${t.expanded.type}; only frames and groups have children`);
    // Inside an instance the new node joins the children override of the frame it goes into.
    const desc = { ...(t.ref.descendants ?? {}) };
    const replaced = this.replacementKey(desc, t.key);
    const key = replaced ?? t.key;
    const entry = desc[key] ?? {};
    let children = entry.children as Node[] | undefined;
    if (!children && !replaced) children = structuredClone(childrenOf(this.doc.get(t.key.split('/').pop()!) ?? ({} as Node)) ?? []);
    children = [...(children ?? [])];
    children.splice(index ?? children.length, 0, node);
    desc[key] = { ...entry, children };
    this.editor.set(t.ref.id, { descendants: desc });
    this.changed();
    return [...t.path.split('/').slice(0, -1), node.id].join('/');
  }

  /** Override or modify, as seen through an instance, the node at `t`. */
  private writeOverride(t: Inside, data: Props): void {
    this.checkProps(t.expanded.type, data, t.path, 'Update');
    const desc = { ...(t.ref.descendants ?? {}) };
    const replaced = this.replacementKey(desc, t.key);
    const key = replaced ?? t.key;
    desc[key] = { ...(desc[key] ?? {}), ...structuredClone(data) };
    this.editor.set(t.ref.id, { descendants: desc });
    this.changed();
  }

  /** When the node at `key` is the root of a replacement written earlier, the key that replacement is stored under. */
  private replacementKey(desc: Record<string, Props>, key: string): string | undefined {
    if ('type' in (desc[key] ?? {})) return key;
    const parts = key.split('/');
    const last = parts.pop()!;
    const prefix = parts.length ? `${parts.join('/')}/` : '';
    return Object.keys(desc).find((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/') && 'type' in desc[k] && desc[k].id === last);
  }

  private noteCreated(node: Node, deep: boolean, id: string): void {
    const prefix = id.slice(0, id.length - node.id.length);
    const visit = (n: Node) => {
      const comp = n.type === 'ref' ? this.doc.get((n as RefNode).ref) : undefined;
      const name = n.name ?? (n.type === 'ref' ? `${comp?.name ?? (n as RefNode).ref} (instance)` : n.type);
      this.out.created.push({ id: prefix + n.id, name });
      if (deep) childrenOf(n)?.forEach(visit);
    };
    visit(node);
  }

  private warnInstances(id: string, what: string): void {
    let count = 0;
    const visit = (n: Node) => { if (n.type === 'ref' && (n as RefNode).ref === id) count++; childrenOf(n)?.forEach(visit); };
    this.doc.data.children.forEach(visit);
    if (count) this.out.warnings.push(`component "${id}" ${what}; ${count} instance${count > 1 ? 's' : ''} of it no longer show anything`);
  }

  private serialize(node: Node, depth: number, o: GetOptions, outer: ThemeContext): Props {
    let n = node;
    if (o.resolveInstances && n.type === 'ref') n = expandTree(this.doc, n) ?? n;
    const ctx = withTheme(outer, n.theme);
    const src = (o.resolveVariables ? resolveDeep(this.doc, n, ctx) : n) as Props;
    const out: Props = { type: src.type, id: src.id };
    for (const [k, v] of Object.entries(src)) {
      if (k === 'type' || k === 'id' || k === 'children') continue;
      out[k] = k === 'geometry' && !o.includePathGeometry ? '...' : v;
    }
    const kids = childrenOf(n);
    if (kids) out.children = depth > 0 ? kids.map((c) => this.serialize(c, depth - 1, o, ctx)) : kids.length ? '...' : [];
    return out;
  }

  private entry(node: Node, parentBox: Box | undefined, o: GetOptions, outer: ThemeContext): TreeEntry {
    const expanded = node.type === 'ref' ? expandTree(this.doc, node) : undefined;
    const shown = o.resolveInstances && expanded ? expanded : node;
    const ctx = withTheme(outer, shown.theme);
    const n = this.serialize(shown, 0, o, outer);
    if (Array.isArray(n.children) || n.children === '...') n.children = [];
    const laid = this.bounds.box(node.id);
    const b = laid ?? { x: num(node.x), y: num(node.y), width: 0, height: 0 };
    const e: TreeEntry = { n, b };
    if (laid && parentBox) {
      const p = problemOf(laid, parentBox);
      if (p) e.p = p;
    }
    const kids = node.type === 'ref' ? childrenOf(expanded ?? node) : childrenOf(node);
    if (kids?.length) e.c = kids.map((k) => this.entry(k, laid, o, ctx));
    return e;
  }

  private captureAll(ids: unknown, fn: string): CapturedScene[] {
    if (!Array.isArray(ids) || !ids.length || !ids.every((i) => typeof i === 'string')) throw new ExecError(`${fn}: expected a non-empty array of node ids`);
    return ids.map((id) => this.capture(id, fn));
  }

  private capture(id: string, fn: string): CapturedScene {
    if (id === DOCUMENT) return this.captureDocument(fn);
    const first = id.split('/')[0];
    const top = this.doc.topLevel(first);
    if (!top) throw new ExecError(`${fn}: node "${id}" not found`);
    const root = buildScene(this.doc, top);
    const target = root && findScene(root, id);
    if (!target) throw new ExecError(`${fn}: node "${id}" is not shown (it or an ancestor has enabled: false, or it does not exist)`);
    return { id, root, target };
  }

  /** The whole canvas as one scene: every top-level node inside a frame that bounds them all. */
  private captureDocument(fn: string): CapturedScene {
    const parts = this.doc.data.children
      .map((n) => ({ scene: buildScene(this.doc, n), box: this.bounds.box(n.id) }))
      .filter((p): p is { scene: SceneNode; box: Box } => !!p.scene && !!p.box);
    const all = union(parts.map((p) => p.box));
    if (!all) throw new ExecError(`${fn}: the document is empty`);
    const root: SceneNode = {
      id: DOCUMENT, type: 'frame', layout: 'none', x: all.x, y: all.y, width: all.width, height: all.height,
      children: parts.map((p) => ({ ...p.scene, x: p.box.x - all.x, y: p.box.y - all.y })),
    };
    return { id: DOCUMENT, root, target: root };
  }
}

function checkGetOptions(opts: unknown): GetOptions {
  if (opts === undefined || opts === null) return {};
  if (!isObject(opts)) throw new ExecError('Get: options must be an object like {depth: 1}');
  for (const k of Object.keys(opts)) {
    if (!['depth', 'resolveVariables', 'resolveInstances', 'includePathGeometry'].includes(k)) throw new ExecError(`Get: unknown option "${k}"`);
  }
  if (opts.depth !== undefined && (typeof opts.depth !== 'number' || opts.depth < 0)) throw new ExecError('Get: depth must be a number >= 0');
  return opts as GetOptions;
}

function checkVariable(name: string, v: unknown): void {
  const where = `SetVariables: "${name}"`;
  if (!name || name.startsWith('$')) throw new ExecError(`${where}: variable names are given without "$"`);
  if (!isObject(v)) throw new ExecError(`${where} must be {type, value}`);
  const type = v.type as string;
  if (!VARIABLE_TYPES.has(type)) throw new ExecError(`${where}: type must be "boolean", "color", "number" or "string"`);
  const checkValue = (x: unknown, at: string) => {
    if (typeof x === 'string' && x.startsWith('$') && x.length > 1) return;
    const ok = type === 'color' ? typeof x === 'string' && COLOR_RE.test(x) : typeof x === type && (type !== 'number' || Number.isFinite(x));
    if (!ok) throw new ExecError(`${where}${at}: expected a ${type === 'color' ? 'hex color' : type} or "$variable", got ${JSON.stringify(x)}`);
  };
  for (const k of Object.keys(v)) if (k !== 'type' && k !== 'value') throw new ExecError(`${where}: unknown key "${k}"`);
  if (Array.isArray(v.value)) {
    v.value.forEach((entry, i) => {
      if (!isObject(entry) || !('value' in entry)) throw new ExecError(`${where}.value[${i}] must be {value, theme?}`);
      checkValue(entry.value, `.value[${i}]`);
      if (entry.theme !== undefined && (!isObject(entry.theme) || !Object.values(entry.theme).every((x) => typeof x === 'string'))) {
        throw new ExecError(`${where}.value[${i}].theme must map theme axes to values, like {mode: "dark"}`);
      }
    });
  } else checkValue(v.value, '');
}

function union(boxes: Box[]): Box | undefined {
  if (!boxes.length) return undefined;
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width)), y1 = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

function findParent(tree: Node, child: Node): Node | undefined {
  for (const c of childrenOf(tree) ?? []) {
    if (c === child) return tree;
    const hit = findParent(c, child);
    if (hit) return hit;
  }
  return undefined;
}

function findScene(root: SceneNode, id: string): SceneNode | undefined {
  if (root.id === id) return root;
  for (const c of root.children ?? []) {
    const hit = findScene(c, id);
    if (hit) return hit;
  }
  return undefined;
}
