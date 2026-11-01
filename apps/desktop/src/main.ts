import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDaemon, type DaemonInfo } from '@nib/daemon';
import { configure, statuses, type ServerCommand } from './mcp-clients.ts';
import { check, install, setAutomatic, startUpdates, updateState } from './updates.ts';

const here = dirname(fileURLToPath(import.meta.url));
const PRELOAD = join(here, 'preload.cjs');
const MCP_MAIN = resolvePath(here, '..', '..', '..', 'packages', 'mcp', 'src', 'main.ts');

/** How MCP clients start nib-mcp: this executable, running as Node. */
const SERVER: ServerCommand = { command: process.execPath, args: [MCP_MAIN], env: { ELECTRON_RUN_AS_NODE: '1' } };

/** Smoke test (development): windows stay hidden; screenshots and checks are written to this folder, then the app quits. */
const SMOKE = process.env.NIB_DESKTOP_SMOKE;

let daemon: DaemonInfo | undefined;
let dashboard: BrowserWindow | undefined;
let settings: BrowserWindow | undefined;
const documents = new Map<string, BrowserWindow>();
/** Files asked for before the app was ready (open-file arrives early on macOS). */
const pending: string[] = [];

if (!app.requestSingleInstanceLock()) app.quit();
app.setName('nib');

const pensIn = (argv: string[]) => argv.slice(1).filter((a) => /\.(pen|fig)$/i.test(a) && !a.startsWith('-')).map((a) => resolvePath(a));

app.on('second-instance', (_e, argv) => {
  const files = pensIn(argv);
  if (files.length) files.forEach(openDocument);
  else showDashboard();
});

app.on('open-file', (e, path) => {
  e.preventDefault();
  if (daemon) openDocument(path);
  else pending.push(path);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (!BrowserWindow.getAllWindows().length) showDashboard();
});

/** Pages come from the daemon; the token goes in the hash, which never reaches a server log. */
function pageUrl(params: Record<string, string>): string {
  if (!daemon) throw new Error('the nib daemon is not running');
  return `http://127.0.0.1:${daemon.port}/#${new URLSearchParams({ t: daemon.token, ...params })}`;
}

function makeWindow(title: string, params: Record<string, string>, size = { width: 1440, height: 900 }): BrowserWindow {
  const win = new BrowserWindow({
    ...size,
    minWidth: 900,
    minHeight: 600,
    title,
    show: false,
    backgroundColor: '#131315',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 18, y: 22 },
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false },
  });
  if (!SMOKE) win.once('ready-to-show', () => win.show());
  const origin = `http://127.0.0.1:${daemon!.port}`;
  // Pages may only show nib itself; links to anything else open in the user's browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:\/\//.test(url)) void shell.openExternal(url); }
  });
  void win.loadURL(pageUrl(params));
  return win;
}

function showDashboard(): void {
  if (dashboard && !dashboard.isDestroyed()) { dashboard.show(); dashboard.focus(); return; }
  dashboard = makeWindow('nib', {}, { width: 1280, height: 840 });
  dashboard.on('closed', () => { dashboard = undefined; });
}

function openDocument(file: string): void {
  const path = resolvePath(file);
  // A Figma file opens as the .pen document made from it, beside it.
  if (/\.fig$/i.test(path)) {
    void api('/api/import-figma', { path }).then((r) => {
      const made = r as { path?: string; error?: string };
      if (made.path) openDocument(made.path);
      else dialog.showErrorBox('nib could not open the Figma file', made.error ?? path);
    });
    return;
  }
  const open = documents.get(path);
  if (open && !open.isDestroyed()) { open.show(); open.focus(); return; }
  const win = makeWindow(basename(path), { file: path });
  if (process.platform === 'darwin') win.setRepresentedFilename(path);
  documents.set(path, win);
  win.on('closed', () => documents.delete(path));
  app.addRecentDocument(path);
}

function showSettings(): void {
  if (settings && !settings.isDestroyed()) { settings.focus(); return; }
  settings = makeWindow('nib settings', { view: 'settings' }, { width: 760, height: 640 });
  settings.on('closed', () => { settings = undefined; });
}

async function newFile(): Promise<void> {
  const r = await api('/api/new', {});
  openDocument((r as { path: string }).path);
}

async function pickFile(): Promise<string | undefined> {
  const r = await dialog.showOpenDialog({ title: 'Open a design', filters: [{ name: 'Designs (.pen, Figma .fig)', extensions: ['pen', 'fig'] }], properties: ['openFile'] });
  return r.canceled ? undefined : r.filePaths[0];
}

async function api(path: string, body?: unknown): Promise<unknown> {
  const r = await fetch(`http://127.0.0.1:${daemon!.port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${daemon!.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return r.json();
}

/** Menu commands go to the focused page, which knows whether a text field or the canvas should act. */
const command = (name: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('nib:command', name);

function buildMenu(): void {
  const mac = process.platform === 'darwin';
  const template: MenuItemConstructorOptions[] = [
    ...(mac ? [{ label: 'nib', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Check for Updates…', click: () => void checkByHand() },
      { label: 'Settings…', accelerator: 'Cmd+,', click: showSettings },
      { type: 'separator' }, { role: 'services' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' },
    ] } as MenuItemConstructorOptions] : []),
    { label: 'File', submenu: [
      { label: 'New File', accelerator: 'CmdOrCtrl+N', click: () => void newFile() },
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: async () => { const p = await pickFile(); if (p) openDocument(p); } },
      { label: 'Dashboard', accelerator: 'CmdOrCtrl+Shift+D', click: showDashboard },
      { type: 'separator' },
      { label: 'Save a Copy As…', accelerator: 'CmdOrCtrl+Shift+S', click: command('save-as') },
      { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: command('export') },
      { type: 'separator' },
      mac ? { role: 'close' } : { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [
      { label: 'Undo', accelerator: 'CmdOrCtrl+Z', click: command('undo') },
      { label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', click: command('redo') },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
      { label: 'Duplicate', accelerator: 'CmdOrCtrl+D', click: command('duplicate') },
      { label: 'Delete', click: command('delete') },
      { type: 'separator' },
      { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: command('select-all') },
      { label: 'Find…', accelerator: 'CmdOrCtrl+K', click: command('palette') },
    ] },
    { label: 'View', submenu: [
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: command('zoom-in') },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: command('zoom-out') },
      { label: 'Zoom to 100%', accelerator: 'CmdOrCtrl+0', click: command('zoom-100') },
      { label: 'Zoom to Fit', accelerator: 'Shift+1', click: command('zoom-fit') },
      { type: 'separator' },
      { label: 'Left Panel', accelerator: 'CmdOrCtrl+\\', click: command('toggle-panel') },
      { label: 'Activity', click: command('toggle-activity') },
      { type: 'separator' },
      { role: 'reload' }, { role: 'toggleDevTools' }, { role: 'togglefullscreen' },
    ] },
    { role: 'windowMenu' },
    ...(mac ? [] : [{ label: 'Help', submenu: [{ label: 'Check for Updates…', click: () => void checkByHand() }] } as MenuItemConstructorOptions]),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/** The menu's Check for Updates: says what it found, since nothing else may show it. */
async function checkByHand(): Promise<void> {
  const s = await check();
  if (s.status === 'ready') {
    const r = await dialog.showMessageBox({ message: `nib ${s.version} is ready`, detail: 'nib restarts to update; open documents come back.', buttons: ['Restart to Update', 'Later'], defaultId: 0 });
    if (r.response === 0) await install(daemon?.pid);
  } else if (s.status === 'available') {
    const r = await dialog.showMessageBox({ message: `nib ${s.version} is out`, detail: `You have ${s.current}.`, buttons: ['Download', 'Later'], defaultId: 0 });
    if (r.response === 0 && s.url) void shell.openExternal(s.url);
  } else if (s.status === 'current') void dialog.showMessageBox({ message: 'nib is up to date', detail: `Version ${s.current}.` });
  else if (s.status === 'error') void dialog.showMessageBox({ type: 'warning', message: 'nib could not check for updates', detail: s.error ?? '' });
}

ipcMain.handle('nib:pick-file', () => pickFile());
ipcMain.handle('nib:pick-save-path', async (_e, suggested: string) => {
  const r = await dialog.showSaveDialog({ defaultPath: suggested, filters: [{ name: 'Designs (.pen)', extensions: ['pen'] }] });
  return r.canceled ? undefined : r.filePath;
});
ipcMain.on('nib:open-document', (_e, path: string) => { if (typeof path === 'string' && /\.(pen|fig)$/i.test(path)) openDocument(path); });
ipcMain.on('nib:open-dashboard', () => showDashboard());
ipcMain.on('nib:open-settings', () => showSettings());
ipcMain.on('nib:reveal', (_e, path: string) => { if (typeof path === 'string' && existsSync(path)) shell.showItemInFolder(path); });
ipcMain.on('nib:open-external', (_e, url: string) => { if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url); });
ipcMain.handle('nib:mcp-clients', () => statuses(SERVER));
ipcMain.handle('nib:update-state', () => updateState());
ipcMain.handle('nib:update-check', () => check());
ipcMain.handle('nib:update-install', () => install(daemon?.pid));
ipcMain.handle('nib:update-automatic', (_e, on: boolean) => setAutomatic(on === true));
ipcMain.handle('nib:configure-mcp', (_e, id: string) => configure(id, SERVER));

app.whenReady().then(async () => {
  try {
    daemon = await ensureDaemon();
  } catch (e) {
    dialog.showErrorBox('nib could not start', (e as Error).message);
    app.quit();
    return;
  }
  buildMenu();
  void startUpdates((s) => { for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('nib:update', s); });
  const files = [...pending, ...pensIn(process.argv)];
  if (files.length) files.forEach(openDocument);
  else showDashboard();
  if (SMOKE) void smoke(SMOKE, files);
});

async function smoke(dir: string, files: string[]): Promise<void> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  await mkdir(dir, { recursive: true });
  const report: Record<string, unknown> = { daemon: daemon?.port, clients: await statuses(SERVER) };
  showSettings();
  const wins = [['dashboard', dashboard], ['settings', settings], ...files.map((f) => [basename(f), documents.get(resolvePath(f))])] as [string, BrowserWindow | undefined][];
  for (const [name, win] of wins) {
    if (!win) continue;
    if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-finish-load', () => r()));
    await new Promise((r) => setTimeout(r, 4000));
    report[name] = await win.webContents.executeJavaScript(`({ bridge: typeof window.nibDesktop, platform: window.nibDesktop?.platform, title: document.title, text: document.body.innerText.slice(0, 300) })`);
    await writeFile(join(dir, `${name}.png`), (await win.webContents.capturePage()).toPNG());
  }
  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2));
  app.quit();
}
