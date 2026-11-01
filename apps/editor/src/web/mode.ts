import { authHeaders } from '../app/connection.ts';

/**
 * Whether this editor is nib's website (`nib web`: no daemon, documents kept in the browser) rather than the
 * app's or a local daemon's. The site says so in its config.
 */
export const site = { web: false, app: 'https://github.com/Last-emo-boy/nib/releases' };

export async function detectSite(): Promise<void> {
  try {
    const j = (await (await fetch('/api/config', { headers: authHeaders() })).json()) as { web?: boolean; app?: string };
    site.web = j.web === true;
    if (j.app) site.app = j.app;
  } catch {
    // No config: an app or daemon that is not answering yet. Not the website.
  }
}

/** Documents kept in the browser are named web:<id>/<name>.pen. */
export const isWebDoc = (path: string | undefined) => !!path?.startsWith('web:');
export const webDocId = (path: string) => path.slice(4).split('/')[0];
export const webDocPath = (id: string, name: string) => `web:${id}/${name.replace(/[/\\]/g, '-')}.pen`;
