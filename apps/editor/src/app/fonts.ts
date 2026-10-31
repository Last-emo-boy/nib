import { post } from './libraries.ts';
import { authHeaders } from './connection.ts';
import { store, toast } from './store.ts';
import { getEngine } from '../canvas/engine.ts';
import { canvas } from '../canvas/Canvas.tsx';

/** The families a design can use: its own (font files in fonts/ beside it) and those installed here. */
export interface FontList { project: { family: string; faces: { weight: number; italic: boolean }[] }[]; installed: string[] }

/** Families people reach for on Google Fonts, which nib loads by name. */
export const GOOGLE_FONTS = [
  'Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Source Sans 3', 'Noto Sans', 'Noto Serif', 'Noto Sans SC', 'Noto Serif SC',
  'Raleway', 'Nunito', 'Work Sans', 'DM Sans', 'DM Serif Display', 'Manrope', 'IBM Plex Sans', 'IBM Plex Serif', 'IBM Plex Mono', 'Playfair Display',
  'Merriweather', 'Lora', 'PT Serif', 'Rubik', 'Karla', 'Space Grotesk', 'Space Mono', 'JetBrains Mono', 'Fira Code', 'Fira Sans', 'Archivo',
  'Barlow', 'Outfit', 'Plus Jakarta Sans', 'Sora', 'Figtree', 'Geist', 'Geist Mono', 'Bricolage Grotesque', 'Libre Baskerville', 'Crimson Pro',
  'EB Garamond', 'Cormorant Garamond', 'Oswald', 'Bebas Neue', 'Anton', 'Caveat', 'Pacifico', 'Lexend', 'Urbanist', 'Mulish', 'Quicksand',
  'Josefin Sans', 'Instrument Serif', 'Instrument Sans', 'Onest', 'Red Hat Display', 'Albert Sans', 'Schibsted Grotesk',
];

let cached: { doc: string; list: Promise<FontList> } | undefined;

export function fontList(refresh = false): Promise<FontList> {
  const doc = store.get().conn?.path ?? '';
  if (!cached || cached.doc !== doc || refresh) {
    cached = { doc, list: fetch(`/api/fonts?${new URLSearchParams({ doc })}`, { headers: authHeaders() }).then((r) => (r.ok ? r.json() : { project: [], installed: [] })) };
  }
  return cached.list;
}

export const isFontFile = (f: File) => /\.(ttf|otf|ttc|otc)$/i.test(f.name);

/**
 * Add font files to the design (kept in fonts/ beside it) and draw text in their families again. Returns the
 * families added.
 */
export async function addFontFiles(files: File[]): Promise<string[]> {
  const { conn } = store.get();
  if (!conn) return [];
  const added: string[] = [];
  for (const f of files) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const r = await post<{ file: string; families: string[] }>('/api/font-file', { path: conn.path, name: f.name, data: btoa(bin) });
      added.push(...r.families);
    } catch (e) {
      toast(`${f.name}: ${(e as Error).message}`);
    }
  }
  if (!added.length) return [];
  const { renderer } = await getEngine();
  for (const family of added) renderer.fonts.forget(family);
  canvas.cache?.refreshAll();
  void fontList(true);
  toast(store.get().lang === 'zh' ? `已把字体加入此设计：${added.join('、')}` : `Added to this design: ${added.join(', ')}`);
  return added;
}

/** Ask for font files and add them. */
export function pickFontFiles(): Promise<string[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.ttf,.otf,.ttc,.otc,font/ttf,font/otf';
    input.multiple = true;
    input.onchange = () => void addFontFiles([...(input.files ?? [])]).then(resolve);
    input.click();
  });
}
