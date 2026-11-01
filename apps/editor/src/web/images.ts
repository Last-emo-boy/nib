import type { ImageLoader } from '@nib/render';
import { webDocId } from './mode.ts';
import { access, fileIn, getAsset, getDoc } from './storage.ts';

/**
 * Pictures of a document kept in the browser: ones added here (kept with it), then ones in its folder when
 * nib may see it, then web addresses (which load only where their server allows it).
 */
export function webImages(path: string): ImageLoader {
  const id = webDocId(path);
  return {
    async load(url: string) {
      if (/^(https?:|data:|blob:)/.test(url)) {
        try {
          const r = await fetch(url);
          return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined;
        } catch {
          return undefined;
        }
      }
      const kept = await getAsset(id, url);
      if (kept) return kept;
      const dir = (await getDoc(id))?.dir;
      if (!dir || !(await access(dir, 'read', false))) return undefined;
      const h = await fileIn(dir, url);
      return h ? new Uint8Array(await (await h.getFile()).arrayBuffer()) : undefined;
    },
  };
}
