// nib's Chrome extension, built into a folder Chrome loads unpacked (out/chrome) and a zip for a release
// or the Chrome Web Store (out/nib-chrome.zip): node apps/chrome/src/build.ts [folder]
import { execFileSync } from 'node:child_process';
import { cp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { domToPen, MAX_IMPORT } from '../../../packages/daemon/src/browser/dom-import.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const source = join(here, '../extension');

/** The script the popup injects into a page: nib's DOM capture, then the copy and pick code. */
export async function captureScript(): Promise<string> {
  const page = await readFile(join(source, 'page.js'), 'utf8');
  return `(() => {\nconst domToPen = ${domToPen.toString()};\nconst MAX_NODES = ${MAX_IMPORT};\n${page}\n})();\n`;
}

/** The unpacked extension in `out`, its version the app's. */
export async function buildExtension(out: string): Promise<void> {
  await rm(out, { recursive: true, force: true });
  await cp(source, out, { recursive: true, filter: (p) => !p.endsWith('page.js') });
  const manifest = JSON.parse(await readFile(join(source, 'manifest.json'), 'utf8'));
  manifest.version = JSON.parse(await readFile(join(root, 'apps/desktop/package.json'), 'utf8')).version;
  await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(out, 'capture.js'), await captureScript());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(root, 'out/chrome'));
  await buildExtension(out);
  const zip = join(dirname(out), 'nib-chrome.zip');
  await rm(zip, { force: true });
  execFileSync('zip', ['-qrX', zip, '.'], { cwd: out });
  process.stdout.write(`${out}\n${zip}\n`);
}
