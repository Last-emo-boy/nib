#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPORTERS } from '@nib/export';
import { createNodeRenderer, FallbackFontLoader, GoogleFontsLoader, imagesFor, PackageIconSource, platformFallbacks, SystemFontLoader } from '@nib/render/node';
import { DocumentHost } from './host.ts';
import { removeInfo, writeInfo } from './info.ts';
import { DAEMON_VERSION, DEFAULT_PORT, startDaemon } from './server.ts';

// The daemon exits after this long without editors connected or API calls.
const IDLE_MS = Number(process.env.NIB_IDLE_MS ?? 30 * 60_000);

const fonts = new FallbackFontLoader(new GoogleFontsLoader(), new SystemFontLoader());
const icons = new PackageIconSource();
const fallbacks = platformFallbacks();
const renderer = await createNodeRenderer({ fonts, icons, fallbacks });
const host = new DocumentHost({ renderer, images: imagesFor, exporters: EXPORTERS });
const editorDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'apps', 'editor', 'dist');

let timer: ReturnType<typeof setTimeout> | undefined;
const daemon = await startDaemon({
  host, fonts, icons, images: imagesFor, fallbacks,
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
  host.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
