import type { CanvasKit } from 'canvaskit-wasm';
import wasmUrl from 'canvaskit-wasm/bin/full/canvaskit.wasm?url';
import { loadCanvasKit, Renderer, type FallbackFamilies, type FontLoader, type IconGeometry, type IconSource, type ImageLoader } from '@nib/render';
import { authHeaders } from '../app/connection.ts';
import { webImages } from '../web/images.ts';
import { isWebDoc } from '../web/mode.ts';

/** Fonts, icons and images come from the daemon, which finds them the same way headless rendering does. */
async function fetchBytes(url: string): Promise<Uint8Array | undefined> {
  const r = await fetch(url, { headers: authHeaders() });
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : undefined;
}

const fonts: FontLoader = {
  load: (f) => fetchBytes(`/api/font?${new URLSearchParams({ family: f.family, weight: String(f.weight), italic: f.italic ? '1' : '0' })}`),
};

const icons: IconSource = {
  async load(library, name, weight) {
    const r = await fetch(`/api/icon?${new URLSearchParams({ library, name, ...(weight !== undefined ? { weight: String(weight) } : {}) })}`, { headers: authHeaders() });
    return r.ok ? ((await r.json()) as IconGeometry) : undefined;
  },
};

export const imagesFor = (docPath: string): ImageLoader => isWebDoc(docPath) ? webImages(docPath) : {
  load: (url) => fetchBytes(`/api/image?${new URLSearchParams({ doc: docPath, url })}`),
};

export interface Engine {
  ck: CanvasKit;
  renderer: Renderer;
}

let engine: Promise<Engine> | undefined;

/** CanvasKit and a renderer configured like the daemon's, so the canvas matches screenshots and exports. */
export function getEngine(): Promise<Engine> {
  return (engine ??= (async () => {
    const [ck, config] = await Promise.all([
      loadCanvasKit(() => wasmUrl),
      fetch('/api/config', { headers: authHeaders() }).then((r) => r.json() as Promise<{ fallbacks: FallbackFamilies }>),
    ]);
    return { ck, renderer: new Renderer({ ck, fonts, icons, fallbacks: config.fallbacks }) };
  })());
}
