declare module 'canvaskit-wasm/bin/full/canvaskit.js' {
  import type { CanvasKit, CanvasKitInitOptions } from 'canvaskit-wasm';
  export default function CanvasKitInit(opts?: CanvasKitInitOptions): Promise<CanvasKit>;
}
