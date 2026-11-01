// The bridge between nib's pages and the desktop app. Pages run sandboxed with no Node access; this is
// all they can ask of the app.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('nibDesktop', {
  platform: process.platform,
  pickFile: () => ipcRenderer.invoke('nib:pick-file'),
  pickSavePath: (suggested) => ipcRenderer.invoke('nib:pick-save-path', String(suggested ?? '')),
  openDocument: (path) => ipcRenderer.send('nib:open-document', String(path)),
  pathForFile: (file) => webUtils.getPathForFile(file),
  openDashboard: () => ipcRenderer.send('nib:open-dashboard'),
  openSettings: () => ipcRenderer.send('nib:open-settings'),
  revealInFolder: (path) => ipcRenderer.send('nib:reveal', String(path)),
  openExternal: (url) => ipcRenderer.send('nib:open-external', String(url)),
  mcpClients: () => ipcRenderer.invoke('nib:mcp-clients'),
  configureMcp: (id) => ipcRenderer.invoke('nib:configure-mcp', String(id)),
  updateState: () => ipcRenderer.invoke('nib:update-state'),
  checkForUpdates: () => ipcRenderer.invoke('nib:update-check'),
  installUpdate: () => ipcRenderer.invoke('nib:update-install'),
  setAutomaticUpdates: (on) => ipcRenderer.invoke('nib:update-automatic', on === true),
  onUpdate: (listener) => {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('nib:update', handler);
    return () => ipcRenderer.removeListener('nib:update', handler);
  },
  onCommand: (listener) => {
    const handler = (_event, command) => listener(command);
    ipcRenderer.on('nib:command', handler);
    return () => ipcRenderer.removeListener('nib:command', handler);
  },
});
