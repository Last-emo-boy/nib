import type { Canvas, CanvasKit } from 'canvaskit-wasm';
import type { SceneNode } from '@nib/core';
import { layoutScene, type LayoutResult } from '@nib/layout';
import { drawNode, iconKey, type StrokeAlignment } from './draw.ts';
import { FontStore, fontWeight, type FontFace, type FontLoader } from './fonts.ts';
import { isFontIconLibrary, type IconGeometry, type IconSource } from './icons.ts';
import { ImageStore, type ImageLoader } from './images.ts';
import { fillList } from './paint.ts';
import { facesOf, NOTO_FALLBACKS, TextEngine, type FallbackFamilies } from './text.ts';

export interface RendererOptions {
  ck: CanvasKit;
  fonts: FontLoader;
  icons: IconSource;
  /** Alignment for strokes that do not set one. */
  defaultStrokeAlignment?: StrokeAlignment;
  /** Fonts for CJK and emoji text whose own font lacks them. Default: Noto. */
  fallbacks?: FallbackFamilies;
}

/** Everything one scene needs, loaded: text paragraphs (also used by layout) and layout boxes. */
export interface PreparedScene {
  root: SceneNode;
  layout: LayoutResult;
  text: TextEngine;
  /** Release the paragraphs. */
  dispose(): void;
}

export interface RenderReport {
  missingFonts: FontFace[];
  missingImages: [string, string][];
  missingIcons: string[];
}

/**
 * Renders scenes with CanvasKit. Fonts, icons and decoded images are cached across scenes;
 * images are resolved by the `ImageLoader` given per scene, since image urls are relative to a document.
 */
export class Renderer {
  readonly ck: CanvasKit;
  readonly fonts: FontStore;
  private iconSource: IconSource;
  private icons = new Map<string, IconGeometry | undefined>();
  private imageStores = new WeakMap<ImageLoader, ImageStore>();
  private strokeAlignment: StrokeAlignment;
  readonly fallbacks: FallbackFamilies;

  constructor(opts: RendererOptions) {
    this.ck = opts.ck;
    this.fonts = new FontStore(opts.ck, opts.fonts);
    this.iconSource = opts.icons;
    this.strokeAlignment = opts.defaultStrokeAlignment ?? 'inner';
    this.fallbacks = opts.fallbacks ?? NOTO_FALLBACKS;
  }

  images(loader: ImageLoader): ImageStore {
    let s = this.imageStores.get(loader);
    if (!s) this.imageStores.set(loader, (s = new ImageStore(this.ck, loader)));
    return s;
  }

  /** Load the fonts, icons and images `root` uses, then lay it out. */
  async prepare(root: SceneNode, images: ImageLoader): Promise<PreparedScene> {
    const faces: FontFace[] = [];
    const urls = new Set<string>();
    const iconLoads: Promise<void>[] = [];
    const visit = (n: SceneNode) => {
      if (n.type === 'text' || n.type === 'note' || n.type === 'prompt' || n.type === 'context') faces.push(...facesOf(n, this.fallbacks));
      if (n.type === 'icon' && typeof n.icon === 'string') {
        const library = String(n.library ?? 'lucide');
        const weight = typeof n.weight === 'number' ? n.weight : undefined;
        if (isFontIconLibrary(library)) faces.push({ family: library, weight: fontWeight(weight ?? 400), italic: false });
        else {
          const key = iconKey(library, n.icon, weight);
          if (!this.icons.has(key)) {
            this.icons.set(key, undefined);
            iconLoads.push(this.iconSource.load(library, n.icon, weight).then((g) => { this.icons.set(key, g); }));
          }
        }
      }
      for (const f of [...fillList(n.fill), ...fillList(n.stroke)]) {
        if (f && typeof f === 'object' && (f as { type?: unknown }).type === 'image') {
          const url = (f as { url?: unknown }).url;
          if (typeof url === 'string') urls.add(url);
        }
      }
      n.children?.forEach(visit);
    };
    visit(root);
    await Promise.all([this.fonts.ensure(faces), this.images(images).ensure(urls), ...iconLoads]);
    const text = new TextEngine(this.ck, this.fonts, this.fallbacks);
    const layout = layoutScene(root, text);
    return { root, layout, text, dispose: () => text.dispose() };
  }

  /** Draw a prepared scene. The canvas is in the root's parent space (the root sits at its own x/y). */
  draw(canvas: Canvas, scene: PreparedScene, images: ImageLoader): void {
    drawNode({
      ck: this.ck,
      layout: scene.layout,
      text: scene.text,
      images: this.images(images),
      icons: this.icons,
      defaultStrokeAlignment: this.strokeAlignment,
    }, canvas, scene.root);
  }

  /** PNG of the root node's box at `scale`, with a transparent background unless one is given. */
  async renderPNG(root: SceneNode, images: ImageLoader, opts: { scale?: number; background?: string } = {}): Promise<Uint8Array> {
    const { ck } = this;
    const scene = await this.prepare(root, images);
    try {
      const box = scene.layout.box(root);
      const scale = opts.scale ?? 1;
      const width = Math.max(1, Math.ceil(box.width * scale)), height = Math.max(1, Math.ceil(box.height * scale));
      const surface = ck.MakeSurface(width, height);
      if (!surface) throw new Error(`cannot allocate a ${width}x${height} surface`);
      try {
        const canvas = surface.getCanvas();
        canvas.clear(opts.background ? ck.parseColorString(opts.background) : ck.TRANSPARENT);
        canvas.scale(scale, scale);
        canvas.translate(-box.x, -box.y);
        this.draw(canvas, scene, images);
        surface.flush();
        const img = surface.makeImageSnapshot();
        const png = img.encodeToBytes();
        img.delete();
        if (!png) throw new Error('PNG encoding failed');
        return png;
      } finally {
        surface.delete();
      }
    } finally {
      scene.dispose();
    }
  }

  report(images: ImageLoader): RenderReport {
    return {
      missingFonts: this.fonts.missing(),
      missingImages: this.images(images).failures(),
      missingIcons: [...this.icons].filter(([, g]) => !g).map(([k]) => k),
    };
  }
}
