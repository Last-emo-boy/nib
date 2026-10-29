import type { CanvasKit } from 'canvaskit-wasm';
import CanvasKitInit from 'canvaskit-wasm/bin/full/canvaskit.js';

let loading: Promise<CanvasKit> | undefined;

/** The full CanvasKit build (paragraphs, runtime effects). `locateFile` is needed in browsers to find the wasm. */
export function loadCanvasKit(locateFile?: (file: string) => string): Promise<CanvasKit> {
  return (loading ??= CanvasKitInit(locateFile ? { locateFile } : undefined));
}
