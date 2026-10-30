import type { Canvas, CanvasKit, Image } from 'canvaskit-wasm';
import type { SceneNode } from '@nib/core';
import { layoutScene, type LayoutResult } from '@nib/layout';
import { browserSnapshotUrl, drawNode, iconKey, type StrokeAlignment } from './draw.ts';
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

export interface SceneAssets {
  faces: FontFace[];
  urls: Set<string>;
  icons: { library: string; name: string; weight: number | undefined }[];
}

export interface RasterOptions {
  scale?: number;
  /** Shrink the scale so the longer side stays within this many pixels. */
  maxSide?: number;
  background?: string;
  format?: 'png' | 'jpeg' | 'webp';
  /** JPEG/WEBP quality 1-100. */
  quality?: number;
}

export class FontsNotLoaded extends Error {
  readonly faces: FontFace[];
  constructor(faces: FontFace[]) {
    super(`fonts not loaded: ${faces.map((f) => `${f.family} ${f.weight}${f.italic ? ' italic' : ''}`).join(', ')}`);
    this.faces = faces;
  }
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

  /** Fonts, image urls and vector icons a scene uses. */
  assets(root: SceneNode): SceneAssets {
    const faces: FontFace[] = [];
    const urls = new Set<string>();
    const icons: { library: string; name: string; weight: number | undefined }[] = [];
    const visit = (n: SceneNode) => {
      if (n.type === 'text' || n.type === 'note' || n.type === 'prompt' || n.type === 'context') faces.push(...facesOf(n, this.fallbacks));
      if (n.type === 'icon' && typeof n.icon === 'string') {
        const library = String(n.library ?? 'lucide');
        const weight = typeof n.weight === 'number' ? n.weight : undefined;
        if (isFontIconLibrary(library)) faces.push({ family: library, weight: fontWeight(weight ?? 400), italic: false });
        else icons.push({ library, name: n.icon, weight });
      }
      if (n.type === 'browser') urls.add(browserSnapshotUrl(n));
      for (const f of [...fillList(n.fill), ...fillList(n.stroke)]) {
        if (f && typeof f === 'object' && (f as { type?: unknown }).type === 'image') {
          const url = (f as { url?: unknown }).url;
          if (typeof url === 'string') urls.add(url);
        }
      }
      n.children?.forEach(visit);
    };
    visit(root);
    return { faces, urls, icons };
  }

  async load(assets: SceneAssets, images: ImageLoader): Promise<void> {
    const iconLoads = assets.icons.map(({ library, name, weight }) => {
      const key = iconKey(library, name, weight);
      if (this.icons.has(key)) return undefined;
      this.icons.set(key, undefined);
      return this.iconSource.load(library, name, weight).then((g) => { this.icons.set(key, g); });
    });
    await Promise.all([this.fonts.ensure(assets.faces), this.images(images).ensure(assets.urls), ...iconLoads]);
  }

  /** Load the fonts, icons and images `root` uses, then lay it out. */
  async prepare(root: SceneNode, images: ImageLoader): Promise<PreparedScene> {
    await this.load(this.assets(root), images);
    return this.layoutSync(root);
  }

  /**
   * Lay out without loading anything. Throws `FontsNotLoaded` when the scene needs faces whose loading has not
   * finished, since measuring text with the wrong font would give wrong sizes.
   */
  layoutSync(root: SceneNode): PreparedScene {
    const pending = this.fonts.unsettled(this.assets(root).faces);
    if (pending.length) throw new FontsNotLoaded(pending);
    const text = new TextEngine(this.ck, this.fonts, this.fallbacks);
    const layout = layoutScene(root, text);
    return { root, layout, text, dispose: () => text.dispose() };
  }

  /** Draw a prepared scene. The canvas is in the root's parent space (the root sits at its own x/y). */
  draw(canvas: Canvas, scene: PreparedScene, images: ImageLoader): void {
    drawNode(this.drawContext(scene, images), canvas, scene.root);
  }

  /** Draw `target`, a node of a prepared scene, alone. The canvas is in its parent's space. */
  drawTarget(canvas: Canvas, scene: PreparedScene, target: SceneNode, images: ImageLoader): void {
    drawNode(this.drawContext(scene, images), canvas, target);
  }

  /** PNG of the root node's box at `scale`, with a transparent background unless one is given. */
  async renderPNG(root: SceneNode, images: ImageLoader, opts: RasterOptions = {}): Promise<Uint8Array> {
    return this.renderNode(root, root, images, opts);
  }

  /**
   * Image of `target`, a node inside `root`, drawn alone at its own size (ancestors decide its layout but
   * are not drawn).
   */
  async renderNode(root: SceneNode, target: SceneNode, images: ImageLoader, opts: RasterOptions = {}): Promise<Uint8Array> {
    const { ck } = this;
    return this.rasterize(root, target, images, opts, (img) => {
      const format = opts.format === 'jpeg' ? ck.ImageFormat.JPEG : opts.format === 'webp' ? ck.ImageFormat.WEBP : ck.ImageFormat.PNG;
      const bytes = img.encodeToBytes(format, opts.quality ?? 92);
      if (!bytes) throw new Error(`${opts.format ?? 'png'} encoding failed`);
      return bytes;
    });
  }

  /** Like `renderNode`, as unpremultiplied RGBA pixels. */
  async renderPixels(root: SceneNode, target: SceneNode, images: ImageLoader, opts: RasterOptions = {}): Promise<{ width: number; height: number; rgba: Uint8Array }> {
    const { ck } = this;
    return this.rasterize(root, target, images, opts, (img) => {
      const width = img.width(), height = img.height();
      const rgba = img.readPixels(0, 0, { width, height, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB });
      if (!rgba) throw new Error('cannot read rendered pixels');
      return { width, height, rgba: rgba as Uint8Array };
    });
  }

  private async rasterize<T>(root: SceneNode, target: SceneNode, images: ImageLoader, opts: RasterOptions, read: (img: Image) => T): Promise<T> {
    const { ck } = this;
    const scene = await this.prepare(root, images);
    try {
      const box = scene.layout.box(target);
      let scale = opts.scale ?? 1;
      if (opts.maxSide) scale = Math.min(scale, opts.maxSide / Math.max(1, box.width, box.height));
      const width = Math.max(1, Math.ceil(box.width * scale)), height = Math.max(1, Math.ceil(box.height * scale));
      const surface = ck.MakeSurface(width, height);
      if (!surface) throw new Error(`cannot allocate a ${width}x${height} surface`);
      try {
        const canvas = surface.getCanvas();
        canvas.clear(opts.background ? ck.parseColorString(opts.background) : ck.TRANSPARENT);
        canvas.scale(scale, scale);
        canvas.translate(-box.x, -box.y);
        drawNode(this.drawContext(scene, images), canvas, target);
        surface.flush();
        const img = surface.makeImageSnapshot();
        try {
          return read(img);
        } finally {
          img.delete();
        }
      } finally {
        surface.delete();
      }
    } finally {
      scene.dispose();
    }
  }

  /** A loaded vector icon's geometry. */
  icon(library: string, name: string, weight: number | undefined): IconGeometry | undefined {
    return this.icons.get(iconKey(library, name, weight));
  }

  private drawContext(scene: PreparedScene, images: ImageLoader) {
    return {
      ck: this.ck,
      layout: scene.layout,
      text: scene.text,
      images: this.images(images),
      icons: this.icons,
      defaultStrokeAlignment: this.strokeAlignment,
    };
  }

  /** Whether a vector icon was found; undefined until it was loaded. */
  hasIcon(library: string, name: string, weight: number | undefined): boolean | undefined {
    const key = iconKey(library, name, weight);
    return this.icons.has(key) ? this.icons.get(key) !== undefined : undefined;
  }

  report(images: ImageLoader): RenderReport {
    return {
      missingFonts: this.fonts.missing(),
      missingImages: this.images(images).failures(),
      missingIcons: [...this.icons].filter(([, g]) => !g).map(([k]) => k),
    };
  }
}
