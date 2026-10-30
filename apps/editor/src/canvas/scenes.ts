import type { Canvas, SkPicture as Picture } from 'canvaskit-wasm';
import { buildScene, type Op, type PenDoc, type SceneNode } from '@nib/core';
import type { Node } from '@nib/format';
import type { Box } from '@nib/layout';
import { browserSnapshotUrl, type ImageLoader } from '@nib/render';
import type { Engine } from './engine.ts';

/** A drawn node with its box on the canvas (document coordinates, rotation ignored). */
export interface Placed {
  id: string;
  type: string;
  abs: Box;
  /** Clip box from ancestors with `clip`, if any. */
  clip?: Box;
  depth: number;
}

interface Entry {
  picture?: Picture;
  bounds?: Box;
  /** Scene nodes in paint order. */
  placed: Placed[];
  byId: Map<string, Placed>;
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
  onUpdate: () => void = () => {};

  constructor(engine: Engine, doc: PenDoc, images: ImageLoader) {
    this.engine = engine;
    this.doc = doc;
    this.images = images;
    for (const n of doc.data.children) this.dirty.add(n.id);
  }

  /** Mark what `ops` (already applied to the document) changed. */
  invalidate(ops: Op[]): void {
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
    for (const id of this.entries.keys()) if (!ids.has(id)) { this.entries.get(id)?.picture?.delete(); this.entries.delete(id); }
    this.rebuild();
  }

  /** Load `url` again and redraw the browser nodes showing it. */
  refreshImage(url: string): void {
    this.engine.renderer.images(this.images).forget(url);
    let everything = false;
    for (const id of this.doc.ids()) {
      const n = this.doc.get(id);
      if (n?.type === 'browser' && browserSnapshotUrl(n) === url) everything ||= this.touchesComponent(id) || this.mark(id);
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
    for (const n of this.doc.data.children) {
      const e = this.entries.get(n.id);
      if (!e?.picture) continue;
      const d = shift?.get(n.id);
      if (d) { canvas.save(); canvas.translate(d.dx, d.dy); }
      canvas.drawPicture(e.picture);
      if (d) canvas.restore();
    }
  }

  /** Draw a node invisibly (keeping its layout), e.g. while its text is edited in place. */
  setHidden(id: string | undefined): void {
    const before = this.hidden;
    this.hidden = id;
    for (const h of [before, id]) if (h) { const top = this.topOf(h); if (top) this.dirty.add(top); }
    void this.rebuild();
  }

  box(id: string): Box | undefined {
    const top = this.topOf(id);
    return top ? this.entries.get(top)?.byId.get(id)?.abs : undefined;
  }

  /** The nodes under a document point, deepest first, ending with the top-level node. Instance parts map to their instance. */
  hit(x: number, y: number): string[] {
    const tops = this.doc.data.children;
    for (let i = tops.length - 1; i >= 0; i--) {
      const e = this.entries.get(tops[i].id);
      if (!e?.bounds || !inside(e.bounds, x, y)) continue;
      for (let j = e.placed.length - 1; j >= 0; j--) {
        const p = e.placed[j];
        if (!inside(p.abs, x, y) || (p.clip && !inside(p.clip, x, y))) continue;
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
      for (const p of e.placed) if (p.depth === depth && !p.id.includes('/') && intersects(p.abs, r)) out.push(p.id);
    }
    return out;
  }

  dispose(): void {
    for (const e of this.entries.values()) e.picture?.delete();
    this.entries.clear();
  }

  private chain(id: string): string[] {
    const docId = id.split('/')[0];
    const out = [docId];
    for (const a of this.doc.ancestors(docId)) out.push(a.id);
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
    const { ck, renderer } = this.engine;
    const old = this.entries.get(node.id);
    const scene = buildScene(this.doc, node);
    if (scene && this.hidden) {
      const hide = (n: SceneNode) => { if (n.id === this.hidden) n.opacity = 0; n.children?.forEach(hide); };
      hide(scene);
    }
    if (!scene) {
      old?.picture?.delete();
      this.entries.set(node.id, { placed: [], byId: new Map() });
      return;
    }
    const prepared = await renderer.prepare(scene, this.images);
    try {
      const rec = new ck.PictureRecorder();
      const canvas = rec.beginRecording(ck.LTRBRect(-1e6, -1e6, 1e6, 1e6));
      renderer.draw(canvas, prepared, this.images);
      const picture = rec.finishRecordingAsPicture();
      rec.delete();
      const placed: Placed[] = [];
      const walk = (n: SceneNode, ox: number, oy: number, depth: number, clip: Box | undefined) => {
        const b = prepared.layout.box(n);
        const abs = { x: ox + b.x, y: oy + b.y, width: b.width, height: b.height };
        placed.push({ id: n.id, type: n.type, abs, clip, depth });
        const inner = n.clip === true ? intersect(abs, clip) : clip;
        for (const c of n.children ?? []) walk(c, abs.x, abs.y, depth + 1, inner);
      };
      walk(scene, 0, 0, 0, undefined);
      old?.picture?.delete();
      this.entries.set(node.id, { picture, bounds: placed[0].abs, placed, byId: new Map(placed.map((p) => [p.id, p])) });
    } finally {
      prepared.dispose();
    }
  }
}

const inside = (b: Box, x: number, y: number) => x >= b.x && y >= b.y && x <= b.x + b.width && y <= b.y + b.height;
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function intersect(a: Box, b: Box | undefined): Box {
  if (!b) return a;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}
