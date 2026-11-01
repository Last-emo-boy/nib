import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { buildScene } from '@nib/core';
import { previewUrl } from '../app/libraries.ts';
import { store } from '../app/store.ts';
import { getEngine, imagesFor } from '../canvas/engine.ts';
import { isWebDoc } from './mode.ts';

const drawn = new Map<string, Promise<string | undefined>>();

/** A node's picture as the daemon's previews are (twice 240 px on the longer side), drawn in the browser. */
function draw(path: string, id: string, version: number): Promise<string | undefined> {
  const key = `${path}\n${id}\n${version}`;
  let p = drawn.get(key);
  if (!p) {
    p = (async () => {
      const doc = store.get().doc;
      const node = doc?.get(id);
      const scene = doc && node ? buildScene(doc, node) : undefined;
      if (!scene) return undefined;
      const { renderer } = await getEngine();
      const bytes = await renderer.renderPNG(scene, imagesFor(path), { scale: 2, maxSide: 480 });
      return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
    })().catch(() => undefined);
    drawn.set(key, p);
    // The oldest pictures go once there are many (each edit makes new ones).
    if (drawn.size > 200) {
      const [k, old] = drawn.entries().next().value!;
      drawn.delete(k);
      void old.then((u) => u && URL.revokeObjectURL(u));
    }
  }
  return p;
}

/** An image of a node of the document at `path` (an `alias:id` draws a library's component): the daemon's, or drawn here on the website. */
export function NodeImage({ path, id, version = 0, ...img }: { path: string; id: string; version?: number } & ImgHTMLAttributes<HTMLImageElement>) {
  const web = isWebDoc(path);
  const [src, setSrc] = useState<string | undefined>();
  useEffect(() => {
    if (!web) return;
    let live = true;
    void draw(path, id, version).then((u) => { if (live) setSrc(u); });
    return () => { live = false; };
  }, [web, path, id, version]);
  return <img {...img} src={web ? src : previewUrl(path, id, version)} />;
}
