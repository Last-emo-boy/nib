import type { Node } from '@nib/format';
import { buildScene, type PenDoc, type SceneNode } from '@nib/core';
import type { Box, LayoutResult } from '@nib/layout';

export type LayoutFn = (scene: SceneNode) => { layout: LayoutResult; dispose(): void };

/**
 * Layout boxes of document nodes, computed per top-level node and kept until the document changes.
 * Boxes are relative to the parent (the space of `x`/`y`); ids inside instances are id paths.
 */
export class BoundsCache {
  private doc: PenDoc;
  private layoutFn: LayoutFn;
  private cache = new Map<Node, Map<string, Box>>();

  constructor(doc: PenDoc, layoutFn: LayoutFn) {
    this.doc = doc;
    this.layoutFn = layoutFn;
  }

  invalidate(): void {
    this.cache.clear();
  }

  /** Boxes for every visible node under `top` (a top-level node). Disabled nodes have none. */
  of(top: Node): Map<string, Box> {
    let boxes = this.cache.get(top);
    if (boxes) return boxes;
    boxes = new Map();
    const scene = buildScene(this.doc, top);
    if (scene) {
      const prepared = this.layoutFn(scene);
      try {
        const walk = (n: SceneNode) => { boxes!.set(n.id, prepared.layout.box(n)); n.children?.forEach(walk); };
        walk(scene);
      } finally {
        prepared.dispose();
      }
    }
    this.cache.set(top, boxes);
    return boxes;
  }

  /** Box of a document node or instance path, relative to its parent. */
  box(id: string): Box | undefined {
    const first = id.split('/')[0];
    const top = this.doc.topLevel(first);
    return top ? this.of(top).get(id) : undefined;
  }
}

export type Problem = 'partially clipped' | 'fully clipped';

/** Whether a child box sticks out of its parent's box (both in the parent's space; tolerance half a pixel). */
export function problemOf(child: Box, parent: { width: number; height: number }): Problem | undefined {
  const e = 0.5;
  const outside = child.x + child.width <= e || child.y + child.height <= e || child.x >= parent.width - e || child.y >= parent.height - e;
  if (outside && (child.width > 0 || child.height > 0)) return 'fully clipped';
  if (child.x < -e || child.y < -e || child.x + child.width > parent.width + e || child.y + child.height > parent.height + e) return 'partially clipped';
  return undefined;
}
