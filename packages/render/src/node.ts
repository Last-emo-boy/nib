import path from 'node:path';
import { loadCanvasKit } from './canvaskit.ts';
import { GoogleFontsLoader } from './fonts-node.ts';
import { PackageIconSource } from './icons-node.ts';
import { FileImageLoader } from './images-node.ts';
import { FallbackFontLoader, SystemFontLoader } from './fonts-system.ts';
import { Renderer, type RendererOptions } from './renderer.ts';
import { NOTO_FALLBACKS, type FallbackFamilies } from './text.ts';

export { GoogleFontsLoader } from './fonts-node.ts';
export { PackageIconSource } from './icons-node.ts';
export { FileImageLoader } from './images-node.ts';
export { FallbackFontLoader, FolderFontLoader, SystemFontLoader, type FolderFace } from './fonts-system.ts';
export { faceInfo, faceOffsets } from './sfnt.ts';

/**
 * What a Chromium-based app shows on this platform for CJK and emoji when the design's font lacks them,
 * with Noto behind it.
 */
export function platformFallbacks(): FallbackFamilies {
  const N = NOTO_FALLBACKS;
  if (process.platform === 'darwin') {
    return { han: ['PingFang SC', ...N.han], fullwidth: ['Hiragino Sans', 'PingFang SC', ...N.fullwidth], hangul: ['Apple SD Gothic Neo', ...N.hangul], emoji: ['Apple Color Emoji', ...N.emoji], symbols: ['Apple Symbols', ...N.symbols], arabic: ['Geeza Pro', ...N.arabic], hebrew: ['Arial Hebrew', ...N.hebrew] };
  }
  if (process.platform === 'win32') {
    return { han: ['Microsoft YaHei', ...N.han], fullwidth: ['Microsoft YaHei', ...N.fullwidth], hangul: ['Malgun Gothic', ...N.hangul], emoji: ['Segoe UI Emoji', ...N.emoji], symbols: ['Segoe UI Symbol', ...N.symbols], arabic: ['Segoe UI', ...N.arabic], hebrew: ['Segoe UI', ...N.hebrew] };
  }
  return NOTO_FALLBACKS;
}

/**
 * A renderer with Node loaders: Google Fonts (cached on disk) and then installed fonts, icons from npm
 * packages, platform fallbacks.
 */
export async function createNodeRenderer(opts: Partial<Omit<RendererOptions, 'ck'>> = {}): Promise<Renderer> {
  return new Renderer({
    ck: await loadCanvasKit(),
    fonts: opts.fonts ?? new FallbackFontLoader(new GoogleFontsLoader(), new SystemFontLoader()),
    icons: opts.icons ?? new PackageIconSource(),
    defaultStrokeAlignment: opts.defaultStrokeAlignment,
    fallbacks: opts.fallbacks ?? platformFallbacks(),
  });
}

/** Image loader for a .pen file: relative urls resolve against the file's folder. */
export const imagesFor = (penFile: string) => new FileImageLoader(path.dirname(path.resolve(penFile)));
