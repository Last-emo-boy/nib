import type { Canvas, Paint, SkPicture as Picture } from 'canvaskit-wasm';
import { buildScene, setScriptSource, type Op, type PenDoc, type SceneNode } from '@nib/core';
import type { Node } from '@nib/format';
import type { Box } from '@nib/layout';
import { browserSnapshotUrl, type ImageLoader, type PreparedScene } from '@nib/render';
import type { Engine } from './engine.ts';
import { apply, boundsOf, flip, invert, mul, placement, quad, IDENTITY, type M } from './affine.ts';
import { easeOut, FADE_MS } from './presence.ts';

/** A drawn node: where it is on the canvas, in document coordinates. */
export interface Placed {
  id: string;
  type: string;
  /** Its own top-left corner (where it turns around) and its size. */
  abs: Box;
  /** From its own coordinates (0..width, 0..height) to the document's: moved and turned, not mirrored. */
  matrix: M;
  /** From its children's coordinates to the document's (mirrored by its flipX/flipY too). */
  inner: M;
  /** Its parent's `inner`: the space its x/y are in. */
  parent: M;
  /** The box around it as drawn, turned or not. */
  bounds: Box;
  /** Clip box from ancestors with `clip`, if any. */
  clip?: Box;
  depth: number;
  /** The node it is drawn in (inside instances, a part of the instance). */
  parentId?: string;
}

interface Entry {
  picture?: Picture;
  bounds?: Box;
  /** Scene nodes in paint order. */
  placed: Placed[];
  byId: Map<string, Placed>;
  /** While nodes in it are being revealed. */
  live?: Live;
  /** It has shaders that change with time or follow the pointer: its laid-out scene is drawn every frame. */
  animated?: { prepared: PreparedScene; time: boolean; mouse: boolean };
}

/** When the canvas opened: shaders' @time counts from here. */
const START = performance.now();

/** A top-level node with nodes fading in: its laid-out scene is kept so only drawing is redone. */
interface Live {
  prepared: PreparedScene;
  /** The nodes being revealed, with the opacity they really have. */
  nodes: Map<string, { node: SceneNode; opacity: unknown }>;
  /** The state each node had when the picture was recorded: h hidden, a fading in, s shown. */
  states: string;
  /** Each node fading in, drawn alone. */
  fading: Map<string, Picture>;
}

/**
 * The canvas content: one recorded picture per top-level node, rebuilt only when a change touches it.
 * Panning and zooming just redraw the pictures.
 */
export class SceneCache {
  private engine: Engine;
  private doc: PenDoc;
  private images: ImageLoader;
  private entries = new Map<string, Entry>();
  private dirty = new Set<string>();
  private building: Promise<void> | undefined;
  private hidden: string | undefined;
  private again = false;
  private paint: Paint | undefined;
  /** Node id -> when it starts fading in (performance.now() ms); it is hidden before. */
  reveal = new Map<string, number>();
  onUpdate: () => void = () => {};

  /** Script nodes' layers as the daemon last made them, by node; versions of script files that changed. */
  private scripts = new Map<string, { key: string; nodes?: Node[]; loading?: boolean }>();
  private scriptVersions = new Map<string, number>();
  /** Theme values every frame is drawn with (the language previewed on the canvas). */
  private force: Record<string, string> | undefined;

  /** Draw every frame with `force` winning over their own themes (undefined: as they are). */
  setForce(force: Record<string, string> | undefined): void {
    if (JSON.stringify(force) === JSON.stringify(this.force)) return;
    this.force = force;
    for (const n of this.doc.data.children) this.dirty.add(n.id);
    void this.rebuild();
  }

  /** Fetches what a script node's script makes (the daemon runs scripts). */
  fetchScript: (id: string) => Promise<{ nodes: Node[]; error?: string }> = async () => ({ nodes: [] });

  constructor(engine: Engine, doc: PenDoc, images: ImageLoader) {
    this.engine = engine;
    this.doc = doc;
    this.images = images;
    for (const n of doc.data.children) this.dirty.add(n.id);
    setScriptSource(doc, (node) => this.scriptLayers(node));
  }

  /**
   * A script node's layers: the last ones the daemon made for it, fetched again when its script file, inputs
   * or size change (meanwhile the previous ones are drawn).
   */
  private scriptLayers(node: Node): Node[] | undefined {
    const n = node as Node & { scriptUri?: unknown; inputs?: unknown; width?: unknown; height?: unknown };
    const key = JSON.stringify([n.scriptUri, n.inputs, n.width, n.height, this.scriptVersions.get(String(n.scriptUri)) ?? 0]);
    const got = this.scripts.get(n.id);
    if (got?.key !== key) {
      const entry = { key, nodes: got?.nodes, loading: true };
      this.scripts.set(n.id, entry);
      void this.fetchScript(n.id).then((r) => {
        if (this.scripts.get(n.id) !== entry) return;
        entry.nodes = r.nodes;
        entry.loading = false;
        if (this.touchesComponent(n.id) || this.mark(n.id)) for (const c of this.doc.data.children) this.dirty.add(c.id);
        void this.rebuild();
      }, () => { entry.loading = false; });
    }
    return got?.nodes ? structuredClone(got.nodes) : undefined;
  }

  /** Mark what `ops` (already applied to the document) changed; resolves when it is redrawn. */
  invalidate(ops: Op[]): Promise<void> {
    let everything = false;
    for (const op of ops) {
      if (op.op === 'document') everything = true;
      else if (op.op === 'set') everything ||= this.touchesComponent(op.id) || this.mark(op.id);
      else if (op.parent) everything ||= this.touchesComponent(op.parent) || this.mark(op.parent);
      else if (op.op === 'insert') { this.dirty.add(op.node.id); everything ||= !!op.node.reusable; }
    }
    if (everything) for (const n of this.doc.data.children) this.dirty.add(n.id);
    // Top-level nodes that were removed lose their entry.
    const ids = new Set(this.doc.data.children.map((n) => n.id));
    for (const [id, e] of this.entries) if (!ids.has(id)) { drop(e); this.entries.delete(id); }
    return this.rebuild();
  }

  /** Load `url` again (an image, a browser node's page, a shader or script file) and redraw the nodes showing it. */
  refreshImage(url: string): void {
    this.engine.renderer.images(this.images).forget(url);
    this.engine.renderer.shaders(this.images).forget(url);
    // A script that changed is run again for every node using it.
    this.scriptVersions.set(url, (this.scriptVersions.get(url) ?? 0) + 1);
    const uses = (v: unknown) => (Array.isArray(v) ? v : v ? [v] : []).some((f) => f && typeof f === 'object' && (f as { url?: unknown }).url === url);
    let everything = false;
    for (const id of this.doc.ids()) {
      const n = this.doc.get(id) as (Record<string, unknown> & { id: string; type: string }) | undefined;
      if (n && ((n.type === 'browser' && browserSnapshotUrl(n) === url) || (n.type === 'script' && n.scriptUri === url) || uses(n.fill) || uses(n.stroke) || uses(n.effect))) everything ||= this.touchesComponent(id) || this.mark(id);
    }
    if (everything) for (const n of this.doc.data.children) this.dirty.add(n.id);
    void this.rebuild();
  }

  /** Rebuild dirty entries; calls `onUpdate` as they finish. */
  rebuild(): Promise<void> {
    if (this.building) { this.again = true; return this.building; }
    this.building = (async () => {
      do {
        this.again = false;
        const batch = [...this.dirty];
        this.dirty.clear();
        let since = performance.now();
        for (const id of batch) {
          const node = this.doc.get(id);
          if (!node || this.doc.locate(id)?.parent) continue;
          await this.build(node);
          // Show progress on large documents instead of waiting for every frame.
          if (performance.now() - since > 120) { this.onUpdate(); since = performance.now(); }
        }
        this.onUpdate();
      } while (this.again || this.dirty.size);
    })().finally(() => { this.building = undefined; });
    return this.building;
  }

  /** Draw every top-level picture; `shift` offsets some (top-level nodes being dragged). */
  draw(canvas: Canvas, shift?: ReadonlyMap<string, { dx: number; dy: number }>): void {
    const now = performance.now();
    for (const n of this.doc.data.children) {
      const e = this.entries.get(n.id);
      if (e?.live) this.step(e, now);
      if (!e?.picture && !e?.animated) continue;
      const d = shift?.get(n.id);
      if (d) { canvas.save(); canvas.translate(d.dx, d.dy); }
      if (e.animated) {
        this.engine.renderer.time = (now - START) / 1000;
        this.engine.renderer.draw(canvas, e.animated.prepared, this.images);
      } else canvas.drawPicture(e.picture!);
      if (e.live) for (const [id, picture] of e.live.fading) this.drawFading(canvas, e, id, picture, now);
      if (d) canvas.restore();
    }
  }

  /** Whether nodes are still being revealed (the canvas keeps drawing frames meanwhile). */
  animating(): boolean {
    for (const e of this.entries.values()) if (e.live || e.animated?.time) return true;
    return false;
  }

  /** Whether a shader follows the pointer (the canvas redraws as it moves). */
  followsPointer(): boolean {
    for (const e of this.entries.values()) if (e.animated?.mouse) return true;
    return false;
  }

  /** Draw a node invisibly (keeping its layout), e.g. while its text is edited in place. */
  setHidden(id: string | undefined): void {
    const before = this.hidden;
    this.hidden = id;
    for (const h of [before, id]) if (h) { const top = this.topOf(h); if (top) this.dirty.add(top); }
    void this.rebuild();
  }

  /** Lay out and draw every top-level node again (fonts changed). */
  refreshAll(): void {
    for (const n of this.doc.data.children) this.dirty.add(n.id);
    void this.rebuild();
  }

  box(id: string): Box | undefined {
    return this.placed(id)?.abs;
  }

  /** The box around a node as drawn (a turned node's box is larger than its own). */
  bounds(id: string): Box | undefined {
    return this.placed(id)?.bounds;
  }

  /** What is drawn directly in a node, bottom to top (for an instance: its parts). */
  childrenOf(id: string): string[] {
    const e = this.entries.get(this.topOf(id) ?? '');
    return e ? e.placed.filter((p) => p.parentId === id).map((p) => p.id) : [];
  }

  placed(id: string): Placed | undefined {
    const top = this.topOf(id);
    return top ? this.entries.get(top)?.byId.get(id) : undefined;
  }

  /**
   * The nodes under a document point, deepest first, ending with the top-level node. Parts of instances come
   * first with their id paths, then the instance.
   */
  hit(x: number, y: number): string[] {
    const tops = this.doc.data.children;
    for (let i = tops.length - 1; i >= 0; i--) {
      const e = this.entries.get(tops[i].id);
      if (!e?.bounds || !inside(e.bounds, x, y)) continue;
      for (let j = e.placed.length - 1; j >= 0; j--) {
        const p = e.placed[j];
        if (!inside(p.bounds, x, y) || (p.clip && !inside(p.clip, x, y))) continue;
        const q = apply(invert(p.matrix), x, y);
        if (q.x < 0 || q.y < 0 || q.x > p.abs.width || q.y > p.abs.height) continue;
        return this.chain(p.id);
      }
    }
    return [];
  }

  /** Top-level nodes and their direct children whose boxes intersect a rectangle. */
  within(r: Box, depth: number): string[] {
    const out: string[] = [];
    for (const n of this.doc.data.children) {
      const e = this.entries.get(n.id);
      if (!e) continue;
      for (const p of e.placed) if (p.depth === depth && !p.id.includes('/') && intersects(p.bounds, r)) out.push(p.id);
    }
    return out;
  }

  dispose(): void {
    for (const e of this.entries.values()) drop(e);
    this.entries.clear();
    this.paint?.delete();
    this.paint = undefined;
  }

  private chain(id: string): string[] {
    const e = this.entries.get(this.topOf(id) ?? '');
    const out: string[] = [];
    for (let p = e?.byId.get(id); p; p = p.parentId ? e!.byId.get(p.parentId) : undefined) out.push(p.id);
    return out;
  }

  private topOf(id: string): string | undefined {
    return this.doc.topLevel(id.split('/')[0])?.id;
  }

  private mark(id: string): boolean {
    const top = this.topOf(id);
    if (top) this.dirty.add(top);
    return false;
  }

  /** Changes inside a component change its instances anywhere. */
  private touchesComponent(id: string): boolean {
    const node = this.doc.get(id);
    if (!node) return false;
    return !!node.reusable || this.doc.ancestors(id).some((a) => a.reusable);
  }

  private async build(node: Node): Promise<void> {
    const { renderer } = this.engine;
    const old = this.entries.get(node.id);
    const scene = buildScene(this.doc, node, this.force ? { force: this.force } : {});
    if (scene && this.hidden) {
      const hide = (n: SceneNode) => { if (n.id === this.hidden) n.opacity = 0; n.children?.forEach(hide); };
      hide(scene);
    }
    if (!scene) {
      if (old) drop(old);
      this.entries.set(node.id, { placed: [], byId: new Map() });
      return;
    }
    // Nodes still to be revealed in this scene.
    const revealing = new Map<string, { node: SceneNode; opacity: unknown }>();
    if (this.reveal.size) {
      const now = performance.now();
      const visit = (n: SceneNode) => {
        const at = this.reveal.get(n.id);
        if (at !== undefined && now < at + FADE_MS) revealing.set(n.id, { node: n, opacity: n.opacity });
        n.children?.forEach(visit);
      };
      visit(scene);
    }
    const prepared = await renderer.prepare(scene, this.images);
    const placed: Placed[] = [];
    const walk = (n: SceneNode, parent: M, depth: number, clip: Box | undefined, parentId?: string) => {
      const b = prepared.layout.box(n);
      const matrix = mul(parent, placement(b.x, b.y, typeof n.rotation === 'number' ? n.rotation : 0));
      const inner = n.flipX === true || n.flipY === true ? mul(matrix, flip(b.width, b.height, n.flipX === true, n.flipY === true)) : matrix;
      const bounds = boundsOf(quad(matrix, b.width, b.height));
      placed.push({ id: n.id, type: n.type, abs: { x: matrix[4], y: matrix[5], width: b.width, height: b.height }, matrix, inner, parent, bounds, clip, depth, parentId });
      const within = n.clip === true ? intersect(bounds, clip) : clip;
      // What a script made is part of its node: clicks select the script node, not the layers it drew.
      if (n.type !== 'script') for (const c of n.children ?? []) walk(c, inner, depth + 1, within, n.id);
    };
    walk(scene, IDENTITY, 0, undefined);
    // Turned children can reach past the top-level node unless it clips them.
    const bounds = scene.clip === true ? placed[0].bounds : boundsOf(placed.flatMap((p) => [{ x: p.bounds.x, y: p.bounds.y }, { x: p.bounds.x + p.bounds.width, y: p.bounds.y + p.bounds.height }]));
    const entry: Entry = { bounds, placed, byId: new Map(placed.map((p) => [p.id, p])) };
    if (revealing.size) {
      entry.live = { prepared, nodes: revealing, states: '', fading: new Map() };
      this.step(entry, performance.now());
    } else {
      const anim = renderer.animated(scene, this.images);
      if (anim.time || anim.mouse) entry.animated = { prepared, ...anim };
      else {
        try {
          entry.picture = this.record((c) => renderer.draw(c, prepared, this.images));
        } finally {
          prepared.dispose();
        }
      }
    }
    if (old) drop(old);
    this.entries.set(node.id, entry);
  }

  private record(paint: (canvas: Canvas) => void): Picture {
    const { ck } = this.engine;
    const rec = new ck.PictureRecorder();
    paint(rec.beginRecording(ck.LTRBRect(-1e6, -1e6, 1e6, 1e6)));
    const picture = rec.finishRecordingAsPicture();
    rec.delete();
    return picture;
  }

  /**
   * Bring a revealing entry up to `now`: hidden nodes are left out of its picture, nodes fading in get a
   * picture of their own, and once every node is shown the entry goes back to a plain picture.
   */
  private step(e: Entry, now: number): void {
    const live = e.live!;
    const state = (id: string) => {
      const at = this.reveal.get(id);
      return at === undefined || now >= at + FADE_MS ? 's' : now < at ? 'h' : 'a';
    };
    const states = [...live.nodes.keys()].map(state).join('');
    if (states === live.states) return;
    live.states = states;
    const { ck, renderer } = this.engine;
    const set = (n: { node: SceneNode; opacity: unknown }, shown: boolean) => {
      if (!shown) n.node.opacity = 0;
      else if (n.opacity === undefined) delete n.node.opacity;
      else n.node.opacity = n.opacity as number;
    };
    const entries = [...live.nodes];
    entries.forEach(([, n], i) => set(n, states[i] === 's'));
    entries.forEach(([id, n], i) => {
      if (states[i] !== 'a') { live.fading.get(id)?.delete(); live.fading.delete(id); return; }
      const p = e.byId.get(id);
      if (live.fading.has(id) || !p) return;
      set(n, true);
      live.fading.set(id, this.record((c) => {
        if (p.clip) c.clipRect(ck.LTRBRect(p.clip.x, p.clip.y, p.clip.x + p.clip.width, p.clip.y + p.clip.height), ck.ClipOp.Intersect, true);
        c.concat([p.parent[0], p.parent[2], p.parent[4], p.parent[1], p.parent[3], p.parent[5], 0, 0, 1]);
        renderer.drawTarget(c, live.prepared, n.node, this.images);
      }));
      set(n, false);
    });
    e.picture?.delete();
    e.picture = this.record((c) => renderer.draw(c, live.prepared, this.images));
    if (!/[ha]/.test(states)) {
      for (const id of live.nodes.keys()) this.reveal.delete(id);
      live.prepared.dispose();
      e.live = undefined;
    }
  }

  /** A node fading in: more opaque and closer to its full size as its fade goes on. */
  private drawFading(canvas: Canvas, e: Entry, id: string, picture: Picture, now: number): void {
    const p = e.byId.get(id);
    const at = this.reveal.get(id);
    if (!p || at === undefined) return;
    const { ck } = this.engine;
    const t = easeOut(Math.min(1, Math.max(0, (now - at) / FADE_MS)));
    const b = p.abs, pad = 64;
    this.paint ??= new ck.Paint();
    this.paint.setAlphaf(t);
    canvas.save();
    canvas.saveLayer(this.paint, ck.LTRBRect(b.x - pad, b.y - pad, b.x + b.width + pad, b.y + b.height + pad));
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, scale = 0.96 + 0.04 * t;
    canvas.translate(cx, cy + (1 - t) * 6);
    canvas.scale(scale, scale);
    canvas.translate(-cx, -cy);
    canvas.drawPicture(picture);
    canvas.restore();
    canvas.restore();
  }
}

/** Free an entry's pictures and kept scene. */
function drop(e: Entry): void {
  e.picture?.delete();
  e.animated?.prepared.dispose();
  if (e.live) {
    e.live.prepared.dispose();
    for (const p of e.live.fading.values()) p.delete();
  }
}

const inside = (b: Box, x: number, y: number) => x >= b.x && y >= b.y && x <= b.x + b.width && y <= b.y + b.height;
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function intersect(a: Box, b: Box | undefined): Box {
  if (!b) return a;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
