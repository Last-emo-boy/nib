// Package the desktop app for this machine: pnpm package:desktop (node apps/desktop/scripts/package.ts)
// macOS: out/nib-darwin-<arch>/nib.app (ad-hoc signed) and out/nib-<version>-<arch>.dmg.
// Linux: out/nib-linux-<arch>/ and out/nib-<version>-linux-<arch>.tar.gz. Windows: out/nib-win32-<arch>/
// and out/nib-<version>-win-<arch>.zip.
//
// The app runs nib's TypeScript sources as they are (Node strips the types), and Node will not do that
// for files under node_modules. So the app folder mirrors the repository, packages in packages/ and
// third-party modules installed by pnpm, whose links to workspace packages keep the sources outside
// node_modules. Symlinks are kept as they are when the app is packaged. A zip cannot hold links, so on
// Windows third-party modules are installed as plain folders and the app makes the links to nib's own
// packages when it starts (apps/desktop/src/start.mjs).
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packager } from '@electron/packager';

const desktop = fileURLToPath(new URL('..', import.meta.url));
const root = join(desktop, '..', '..');
const out = join(root, 'out');
const stage = join(out, 'stage');
const electronVersion = (createRequire(import.meta.url)('electron/package.json') as { version: string }).version;
const { version } = JSON.parse(await readFile(join(desktop, 'package.json'), 'utf8')) as { version: string };
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const platform = process.platform === 'win32' ? 'win32' : process.platform === 'linux' ? 'linux' : 'darwin';
const windows = platform === 'win32';

// pnpm is a .cmd script on Windows, which only a shell runs.
const run = (cmd: string, args: string[], cwd = root) => execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: windows });

console.log('Building the editor…');
run('pnpm', ['--filter', '@nib/editor', 'build']);

console.log('Staging the app folder…');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
const skip = (src: string) => !/\/(node_modules|test)(\/|$)/.test(src) && !src.endsWith('.DS_Store');
for (const name of ['core', 'daemon', 'exec', 'export', 'format', 'layout', 'mcp', 'render']) {
  await cp(join(root, 'packages', name), join(stage, 'packages', name), { recursive: true, filter: skip });
}
await cp(join(desktop, 'package.json'), join(stage, 'apps', 'desktop', 'package.json'));
await cp(join(desktop, 'src'), join(stage, 'apps', 'desktop', 'src'), { recursive: true, filter: skip });
await cp(join(root, 'apps', 'editor', 'dist'), join(stage, 'apps', 'editor', 'dist'), { recursive: true });
await writeFile(join(stage, 'package.json'), `${JSON.stringify({ name: 'nib', productName: 'nib', version, private: true, type: 'module', main: windows ? 'apps/desktop/src/start.mjs' : 'apps/desktop/src/main.ts' }, null, 2)}\n`);
await writeFile(join(stage, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n  - apps/desktop\n');
// The repository's lockfile keeps the versions it was tested with (the stage lists fewer projects, so it
// is not frozen); the modules come from the pnpm store of the repository's install. Not --offline: the
// lockfile also names other platforms' optional packages, whose metadata a fresh machine (CI) has not got.
await cp(join(root, 'pnpm-lock.yaml'), join(stage, 'pnpm-lock.yaml'));
run('pnpm', ['install', '--prod', '--prefer-offline', '--ignore-scripts', '--no-frozen-lockfile', ...(windows ? ['--config.node-linker=hoisted'] : [])], stage);
await rm(join(stage, 'pnpm-lock.yaml'), { force: true });
// nib reads the icon packages' SVG folders (and resolves their main file) and the full CanvasKit build;
// their other builds and fonts only make the app larger.
const store = join(stage, 'node_modules', '.pnpm');
const installed = async (name: string) => windows ? join(stage, 'node_modules', name) : join(store, (await readdir(store)).find((d) => d.startsWith(`${name}@`))!, 'node_modules', name);
const lucide = await installed('lucide-static');
const canvaskit = await installed('canvaskit-wasm');
for (const p of [join(lucide, 'font'), join(lucide, 'sprite.svg'), join(lucide, 'dist', 'esm'), join(lucide, 'icon-nodes.json'), join(lucide, 'tags.json'), join(canvaskit, 'bin', 'profiling'), join(canvaskit, 'bin', 'canvaskit.wasm')]) {
  await rm(p, { recursive: true, force: true });
}
for (const f of await readdir(join(lucide, 'dist', 'cjs'))) if (f !== 'lucide-static.js') await rm(join(lucide, 'dist', 'cjs', f), { recursive: true, force: true });
// The agent SDKs' own Claude Code and Codex binaries (600 MB together) stay out: nib's agent uses the
// ones the person installed and signed in to.
if (windows) {
  for (const scope of ['@anthropic-ai', '@openai']) {
    for (const name of await readdir(join(stage, 'node_modules', scope)).catch(() => [] as string[])) {
      if (/^claude-agent-sdk-[a-z0-9]+-[a-z0-9]+$/.test(name) || /^codex-(darwin|linux|win32)-/.test(name)) await rm(join(stage, 'node_modules', scope, name), { recursive: true, force: true });
    }
  }
  // The links pnpm made to nib's own packages: the app makes its own when it starts.
  for (const dir of [join(stage, 'node_modules'), ...(await readdir(join(stage, 'packages'))).map((p) => join(stage, 'packages', p, 'node_modules')), join(stage, 'apps', 'desktop', 'node_modules')]) {
    await rm(join(dir, '@nib'), { recursive: true, force: true });
  }
} else for (const d of await readdir(store)) {
  if (/^@anthropic-ai\+claude-agent-sdk-[a-z0-9]+-[a-z0-9]+@/.test(d) || /^@openai\+codex@[^-]+-(darwin|linux|win32)-/.test(d)) await rm(join(store, d), { recursive: true, force: true });
}
// ...and the links to them, which codesign would refuse.
if (!windows) for (const d of ['', ...(await readdir(store))]) {
  for (const scope of ['@anthropic-ai', '@openai']) {
    // Each package's own links, and pnpm's hoisted ones in .pnpm/node_modules.
    const dir = d ? join(store, d, 'node_modules', scope) : join(store, 'node_modules', scope);
    for (const name of await readdir(dir).catch(() => [] as string[])) {
      if (!(await stat(join(dir, name)).catch(() => undefined))) await rm(join(dir, name), { force: true });
    }
  }
}

console.log(`Packaging with Electron ${electronVersion}…`);
const [appDir] = await packager({
  dir: stage,
  out,
  name: 'nib',
  executableName: 'nib',
  appVersion: version,
  appBundleId: 'xyz.w33d.nib',
  appCategoryType: 'public.app-category.graphics-design',
  appCopyright: 'nib contributors',
  icon: join(desktop, 'build', platform === 'win32' ? 'icon.ico' : 'icon.icns'),
  electronVersion,
  platform,
  arch,
  asar: false,
  prune: false,
  derefSymlinks: false,
  overwrite: true,
  darwinDarkModeSupport: true,
  extendInfo: {
    CFBundleDocumentTypes: [{
      CFBundleTypeName: 'nib design',
      CFBundleTypeExtensions: ['pen'],
      CFBundleTypeRole: 'Editor',
      LSHandlerRank: 'Default',
      CFBundleTypeIconFile: 'electron.icns',
    }, {
      // Figma files open as a .pen document made from them; Figma stays their usual app.
      CFBundleTypeName: 'Figma design',
      CFBundleTypeExtensions: ['fig'],
      CFBundleTypeRole: 'Viewer',
      LSHandlerRank: 'Alternate',
    }],
  },
});
if (platform !== 'darwin') {
  if (platform === 'linux') {
    // As on macOS, copy the app folder again with its relative links as they are.
    const resources = join(appDir, 'resources', 'app');
    await rm(resources, { recursive: true, force: true });
    await cp(stage, resources, { recursive: true, verbatimSymlinks: true });
  }
  const name = appDir.split(/[\\/]/).pop()!;
  const archive = join(out, `nib-${version}-${windows ? 'win' : 'linux'}-${arch}.${windows ? 'zip' : 'tar.gz'}`);
  await rm(archive, { force: true });
  // Windows' own tar (bsdtar, not Git's) writes zip archives too.
  run(windows ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar', windows ? ['-a', '-c', '-f', archive, '-C', out, name] : ['-czf', archive, '-C', out, name]);
  console.log(`\n${appDir}\n${archive}`);
  process.exit(0);
}
const app = join(appDir, 'nib.app');
// The packager's copy turns relative symlinks into absolute ones pointing at the stage: copy it again verbatim.
const resources = join(app, 'Contents', 'Resources', 'app');
await rm(resources, { recursive: true, force: true });
await cp(stage, resources, { recursive: true, verbatimSymlinks: true });

console.log('Signing (ad hoc)…');
run('codesign', ['--force', '--deep', '--sign', '-', app]);
run('codesign', ['--verify', '--deep', '--strict', app]);

console.log('Making the disk image…');
const dmgDir = join(out, 'dmg');
await rm(dmgDir, { recursive: true, force: true });
await mkdir(dmgDir);
await cp(app, join(dmgDir, 'nib.app'), { recursive: true, verbatimSymlinks: true });
await symlink('/Applications', join(dmgDir, 'Applications'));
const dmg = join(out, `nib-${version}-${arch}.dmg`);
await rm(dmg, { force: true });
// `diskutil image` replaces `hdiutil create` on newer macOS.
try {
  run('diskutil', ['image', 'create', 'from', '--format', 'UDZO', '--volumeName', 'nib', dmgDir, dmg]);
} catch {
  run('hdiutil', ['create', '-volname', 'nib', '-srcfolder', dmgDir, '-ov', '-format', 'UDZO', dmg]);
}
await rm(dmgDir, { recursive: true, force: true });

console.log(`\n${app}\n${dmg}`);
