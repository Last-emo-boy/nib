import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Chrome-family browsers nib can drive, most common first. NIB_CHROME overrides. */
async function candidates(): Promise<string[]> {
  const list: string[] = [];
  if (process.env.NIB_CHROME) list.push(process.env.NIB_CHROME);
  if (process.platform === 'darwin') {
    for (const app of ['Google Chrome', 'Chromium', 'Google Chrome Canary', 'Microsoft Edge', 'Brave Browser']) {
      list.push(`/Applications/${app}.app/Contents/MacOS/${app}`, join(homedir(), 'Applications', `${app}.app`, 'Contents', 'MacOS', app));
    }
  } else if (process.platform === 'win32') {
    for (const base of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (base) list.push(join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'), join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else {
    for (const bin of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge']) list.push(`/usr/bin/${bin}`, `/snap/bin/${bin}`);
  }
  // Playwright's downloaded Chromium, when Chrome itself is missing.
  const pw = join(homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
  for (const dir of (await readdir(pw).catch(() => [] as string[])).filter((d) => d.startsWith('chromium-')).sort().reverse()) {
    list.push(join(pw, dir, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), join(pw, dir, 'chrome-mac-arm64', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), join(pw, dir, 'chrome-linux', 'chrome'));
  }
  return list;
}

export interface Chrome {
  /** The browser-level DevTools WebSocket. */
  wsUrl: string;
  process: ChildProcess;
  executable: string;
}

/**
 * Start a headless Chrome with its own profile (never the user's), its DevTools port bound to this machine,
 * and wait for the port it chose.
 */
export async function launchChrome(profileDir: string): Promise<Chrome> {
  const executable = (await candidates()).find((p) => existsSync(p));
  if (!executable) throw new Error('no Chrome-family browser found; install Google Chrome, or set NIB_CHROME to a Chrome or Chromium executable');
  await mkdir(profileDir, { recursive: true });
  const portFile = join(profileDir, 'DevToolsActivePort');
  await rm(portFile, { force: true });
  const child = spawn(executable, [
    '--headless=new', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profileDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-sync', '--mute-audio',
    '--hide-scrollbars', '--disable-features=Translate,MediaRouter', '--force-color-profile=srgb', 'about:blank',
  ], { stdio: 'ignore' });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${executable} exited (${child.exitCode}) before opening its DevTools port`);
    const text = await readFile(portFile, 'utf8').catch(() => '');
    const [port, path] = text.split('\n');
    if (port && path) return { wsUrl: `ws://127.0.0.1:${port.trim()}${path.trim()}`, process: child, executable };
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('the browser did not open its DevTools port within 20s');
}
