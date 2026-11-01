// Finding nib's daemon (the program that holds documents and serves the editor), starting it when it is not
// running: from the nib app, or from a nib checkout with Node 24.
const { spawn } = require('node:child_process');
const { existsSync, readFileSync } = require('node:fs');
const { homedir } = require('node:os');
const { join } = require('node:path');

const home = () => process.env.NIB_HOME || join(homedir(), '.nib');

/** The running daemon's port and token, if it answers. */
async function findDaemon() {
  let info;
  try { info = JSON.parse(readFileSync(join(home(), 'daemon.json'), 'utf8')); } catch { return undefined; }
  try {
    const r = await fetch(`http://127.0.0.1:${info.port}/api/ping`, { signal: AbortSignal.timeout(1500) });
    const body = await r.json();
    return r.ok && body.pid === info.pid ? info : undefined;
  } catch {
    return undefined;
  }
}

/**
 * How to run the daemon: [program, args, env]. `setting` is the nib.path setting; otherwise the app in its
 * usual place, then `nib-daemon` on PATH.
 */
function daemonCommand(setting, platform = process.platform) {
  const candidates = [];
  if (setting) candidates.push(setting);
  if (platform === 'darwin') candidates.push('/Applications/nib.app', join(homedir(), 'Applications', 'nib.app'));
  for (const c of candidates) {
    // The app runs its daemon with its own Electron, as Node.
    const app = join(c, 'Contents', 'MacOS', 'nib');
    const appMain = join(c, 'Contents', 'Resources', 'app', 'packages', 'daemon', 'src', 'main.ts');
    if (existsSync(app) && existsSync(appMain)) return [app, [appMain], { ELECTRON_RUN_AS_NODE: '1' }];
    // A checkout: Node 24 runs its TypeScript as it is.
    const main = join(c, 'packages', 'daemon', 'src', 'main.ts');
    if (existsSync(main)) return ['node', [main], {}];
  }
  return ['nib-daemon', [], {}];
}

/** The daemon, started in the background first when it is not running. */
async function ensureDaemon(setting, timeoutMs = 20000) {
  const running = await findDaemon();
  if (running) return running;
  const [program, args, env] = daemonCommand(setting);
  const child = spawn(program, args, { detached: true, stdio: 'ignore', env: { ...process.env, ...env } });
  child.on('error', () => {});
  child.unref();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    const info = await findDaemon();
    if (info) return info;
  }
  throw new Error('nib is not running and could not be started: install the nib app, or set nib.path to a nib checkout');
}

/** The webview's page: nib's editor for `file`, from the daemon at `origin`, filling the tab. */
function editorHtml(origin, token, file, cspSource) {
  const src = `${origin}/#${new URLSearchParams({ t: token, file })}`;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${esc(origin)}; style-src ${esc(cspSource)} 'unsafe-inline';">
<style>html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; background: #111; } iframe { border: 0; width: 100%; height: 100%; display: block; }</style>
</head><body><iframe src="${esc(src)}" allow="clipboard-read; clipboard-write"></iframe></body></html>`;
}

module.exports = { findDaemon, daemonCommand, ensureDaemon, editorHtml };
