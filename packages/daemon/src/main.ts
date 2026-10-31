#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORTERS } from '@nib/export';
import { createNodeRenderer, FallbackFontLoader, FolderFontLoader, GoogleFontsLoader, imagesFor, PackageIconSource, platformFallbacks, SystemFontLoader } from '@nib/render/node';
import { AgentService } from './agent/service.ts';
import { BrowserService } from './browser/service.ts';
import { DocumentHost } from './host.ts';
import { NIB_HOME } from './library.ts';
import { removeInfo, writeInfo } from './info.ts';
import { DAEMON_VERSION, DEFAULT_PORT, startDaemon } from './server.ts';

// The daemon exits after this long without editors connected or API calls.
const IDLE_MS = Number(process.env.NIB_IDLE_MS ?? 30 * 60_000);

// A design's own fonts (its fonts/ folder) come first, then Google Fonts, then installed fonts.
const projectFonts = new FolderFontLoader(() => host.list().map((d) => join(dirname(d.path), 'fonts')));
const systemFonts = new SystemFontLoader();
const fonts = new FallbackFontLoader(projectFonts, new GoogleFontsLoader(), systemFonts);
const icons = new PackageIconSource();
const fallbacks = platformFallbacks();
const renderer = await createNodeRenderer({ fonts, icons, fallbacks });
// Browser nodes draw the latest snapshot of their page; everything else loads from files and the web.
let browser: BrowserService | undefined;
const images = (file: string) => {
  const files = imagesFor(file);
  return {
    load: (url: string) => {
      const m = /^nib-browser:([^@]+)@(.*)$/.exec(url);
      return m ? browser!.snapshot(file, m[1], m[2]) : files.load(url);
    },
  };
};
const host = new DocumentHost({ renderer, images, exporters: EXPORTERS });
browser = new BrowserService({ host, home: NIB_HOME, fonts });
const agent = new AgentService({
  home: NIB_HOME,
  describe: (doc) => host.describeDocument(doc),
  document: {
    read: async (doc) => structuredClone((await host.open(doc)).session.doc.data),
    restore: async (doc, data, label) => { await host.restore(doc, data, { kind: 'user' }, label); },
  },
});
const editorDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'editor', 'dist');

let timer: ReturnType<typeof setTimeout> | undefined;
const daemon = await startDaemon({
  host, renderer, browser, agent, fonts, projectFonts, systemFonts, icons, images, fallbacks,
  port: Number(process.env.NIB_PORT ?? DEFAULT_PORT),
  editorDir: existsSync(editorDir) ? editorDir : undefined,
  devOrigins: process.env.NIB_DEV_ORIGIN ? process.env.NIB_DEV_ORIGIN.split(',') : undefined,
  token: process.env.NIB_TOKEN,
  onActivity: (clients) => {
    clearTimeout(timer);
    if (clients === 0) timer = setTimeout(shutdown, IDLE_MS);
  },
});
await writeInfo({ port: daemon.port, token: daemon.token, pid: process.pid, version: DAEMON_VERSION });
timer = setTimeout(shutdown, IDLE_MS);
process.stderr.write(`nib daemon on ${daemon.url} (pid ${process.pid})\n`);

async function shutdown(): Promise<void> {
  await removeInfo(process.pid);
  await daemon.close();
  browser?.close();
  host.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
