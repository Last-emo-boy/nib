import { desktop, openDocument } from './desktop.ts';
import { strings } from './i18n.ts';
import { post } from './libraries.ts';
import { toast } from './store.ts';

export const isFigmaFile = (f: File | string) => /\.fig$/i.test(typeof f === 'string' ? f : f.name);

/**
 * Open a Figma file as the .pen document nib makes from it: one on disk beside it, one dropped in from
 * elsewhere in the drafts. Says what did not carry over exactly.
 */
export async function openFigma(source: string | File): Promise<void> {
  const t = strings();
  toast(t.importingFigma);
  try {
    let body: Record<string, string>;
    const onDisk = typeof source === 'string' ? source : desktop?.pathForFile(source);
    if (onDisk) body = { path: onDisk };
    else {
      const bytes = new Uint8Array(await (source as File).arrayBuffer());
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      body = { name: (source as File).name, data: btoa(bin) };
    }
    const r = await post<{ path: string; layers: number; notes: string[] }>('/api/import-figma', body);
    const notice = t.figmaImported(r.layers, r.notes);
    // A browser tab reloads to open it, so the notice waits for the page it opens.
    if (!desktop) sessionStorage.setItem('nib-notice', notice);
    toast(notice);
    openDocument(r.path);
  } catch (e) {
    toast((e as Error).message);
  }
}
