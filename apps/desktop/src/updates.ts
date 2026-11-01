import { execFile, spawn } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { access, constants, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { app } from 'electron';
import { NIB_HOME } from '@nib/daemon';
import { newer, readRelease, type Release } from './update-feed.ts';

/**
 * Updates from nib's GitHub releases. On macOS the new app is downloaded, checked (its signature and
 * version) and put in place of this one when the person restarts, the old one kept until the new one has
 * started; elsewhere nib says a new version is out and where to get it. The app is not signed by Apple,
 * which rules out Electron's own updater.
 */

const run = promisify(execFile);
const FEED = process.env.NIB_UPDATE_FEED ?? 'https://api.github.com/repos/Last-emo-boy/nib/releases/latest';
const DIR = join(NIB_HOME, 'updates');
const SETTINGS = join(NIB_HOME, 'desktop.json');
const EVERY = 6 * 60 * 60 * 1000;

export interface UpdateState {
  status: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
  current: string;
  version?: string;
  url?: string;
  error?: string;
  /** Whether nib can put the new version in place itself (else: download it by hand). */
  installs: boolean;
  automatic: boolean;
}

let state: UpdateState = { status: 'idle', current: app.getVersion(), installs: false, automatic: true };
let ready: { app: string; version: string } | undefined;
let listener: (s: UpdateState) => void = () => {};
let timer: NodeJS.Timeout | undefined;

const set = (next: Partial<UpdateState>) => { state = { ...state, ...next }; listener(state); };

/** The .app this runs from, on macOS. */
function bundle(): string | undefined {
  const m = /^(.*?\.app)\/Contents\/MacOS\//.exec(app.getPath('exe'));
  return m?.[1];
}

/** Whether this copy can be replaced: a packaged Mac app in a folder the person can write to, not on a disk image. */
async function replaceable(): Promise<boolean> {
  const b = bundle();
  if (process.platform !== 'darwin' || !app.isPackaged || !b || b.startsWith('/Volumes/') || b.includes('/AppTranslocation/')) return false;
  try { await access(dirname(b), constants.W_OK); await access(b, constants.W_OK); return true; } catch { return false; }
}

export async function startUpdates(onChange: (s: UpdateState) => void): Promise<void> {
  listener = onChange;
  const saved = JSON.parse(await readFile(SETTINGS, 'utf8').catch(() => '{}')) as { checkForUpdates?: boolean };
  state = { ...state, automatic: saved.checkForUpdates !== false, installs: await replaceable() };
  // What an update left (the version before it, kept until this one started; its script) goes now.
  await rm(DIR, { recursive: true, force: true });
  if (state.automatic && app.isPackaged) schedule();
}

function schedule(): void {
  clearTimeout(timer);
  timer = setTimeout(() => { void check().finally(() => { if (state.automatic) schedule(); }); }, state.status === 'idle' ? 15_000 : EVERY);
}

export function updateState(): UpdateState { return state; }

export async function setAutomatic(on: boolean): Promise<UpdateState> {
  await mkdir(NIB_HOME, { recursive: true });
  const saved = JSON.parse(await readFile(SETTINGS, 'utf8').catch(() => '{}')) as Record<string, unknown>;
  await writeFile(SETTINGS, `${JSON.stringify({ ...saved, checkForUpdates: on }, null, 2)}\n`);
  set({ automatic: on });
  if (on && app.isPackaged) schedule(); else clearTimeout(timer);
  return state;
}

export async function check(): Promise<UpdateState> {
  if (state.status === 'checking' || state.status === 'downloading') return state;
  if (ready) return state;
  set({ status: 'checking', error: undefined });
  try {
    const r = await fetch(FEED, { headers: { accept: 'application/vnd.github+json', 'user-agent': `nib/${state.current}` } });
    if (!r.ok) throw new Error(`the release feed answered ${r.status}`);
    const release = readRelease(await r.json(), process.platform, process.arch === 'arm64' ? 'arm64' : 'x64');
    if (!release || !newer(release.version, state.current)) { set({ status: 'current' }); return state; }
    set({ status: 'available', version: release.version, url: release.url });
    if (state.installs && release.asset) await download(release);
  } catch (e) {
    set({ status: 'error', error: (e as Error).message });
  }
  return state;
}

/** The new app into updates/<version>/, checked before it is offered. */
async function download(release: Release): Promise<void> {
  const asset = release.asset!;
  set({ status: 'downloading' });
  const dir = join(DIR, release.version);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const zip = join(dir, asset.name);
  const r = await fetch(asset.url, { headers: { 'user-agent': `nib/${state.current}` } });
  if (!r.ok || !r.body) throw new Error(`the download answered ${r.status}`);
  await pipeline(Readable.fromWeb(r.body as never), createWriteStream(zip));
  if (asset.size && (await stat(zip)).size !== asset.size) throw new Error('the download is incomplete');
  await run('ditto', ['-x', '-k', zip, dir]);
  await rm(zip, { force: true });
  const next = join(dir, 'nib.app');
  if (!existsSync(next)) throw new Error('the download holds no nib.app');
  await run('codesign', ['--verify', '--deep', '--strict', next]);
  const { stdout } = await run('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', '-o', '-', join(next, 'Contents', 'Info.plist')]);
  if (stdout.trim() !== release.version) throw new Error(`the download is version ${stdout.trim()}, not ${release.version}`);
  ready = { app: next, version: release.version };
  set({ status: 'ready' });
}

/**
 * Restart into the downloaded version: a script waits for this app to quit, stops the daemon it ran (it
 * runs from this app's files), moves this app aside, puts the new one in its place (moving the old one
 * back if that fails) and starts it with the same arguments.
 */
export async function install(daemonPid: number | undefined): Promise<boolean> {
  const b = bundle();
  if (!ready || !b) return false;
  const backup = join(DIR, 'previous', 'nib.app');
  await mkdir(dirname(backup), { recursive: true });
  const script = join(DIR, 'install.sh');
  await writeFile(script, [
    '#!/bin/sh',
    '# nib update: $1 app pid, $2 daemon pid, $3 the app, $4 the new app, $5 where the old one goes; then the arguments to start it with.',
    'while kill -0 "$1" 2>/dev/null; do sleep 0.2; done',
    'case "$(ps -o command= -p "$2" 2>/dev/null)" in *"$3"*) kill "$2" 2>/dev/null ;; esac',
    'rm -rf "$5"',
    'if mv "$3" "$5"; then mv "$4" "$3" || mv "$5" "$3"; fi',
    'app="$3"; shift 5',
    'exec "$app/Contents/MacOS/nib" "$@"',
    '',
  ].join('\n'));
  const child = spawn('/bin/sh', [script, String(process.pid), String(daemonPid ?? ''), b, ready.app, backup, ...process.argv.slice(1)], { detached: true, stdio: 'ignore' });
  child.unref();
  app.quit();
  return true;
}
