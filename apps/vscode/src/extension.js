// nib for VS Code and Cursor: .pen files open in nib's editor, inside a tab. nib's daemon reads and saves the
// file itself, so the tab is a view of it (VS Code holds no copy that could disagree).
const vscode = require('vscode');
const { execFile } = require('node:child_process');
const { ensureDaemon, editorHtml } = require('./daemon.js');

class PenEditor {
  openCustomDocument(uri) {
    return { uri, dispose() {} };
  }

  async resolveCustomEditor(document, panel) {
    panel.webview.options = { enableScripts: true };
    panel.webview.html = '<p style="font: 13px system-ui; color: #888; padding: 16px">Starting nib…</p>';
    try {
      const info = await ensureDaemon(vscode.workspace.getConfiguration('nib').get('path'));
      // Through VS Code, so it also works where the editor runs remotely.
      const origin = (await vscode.env.asExternalUri(vscode.Uri.parse(`http://127.0.0.1:${info.port}`))).toString(true).replace(/\/$/, '');
      panel.webview.html = editorHtml(origin, info.token, document.uri.fsPath, panel.webview.cspSource);
    } catch (e) {
      panel.webview.html = `<p style="font: 13px system-ui; color: #c33; padding: 16px">${String(e.message).replace(/</g, '&lt;')}</p>`;
    }
  }
}

function activate(context) {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('nib.pen', new PenEditor(), { webviewOptions: { retainContextWhenHidden: true }, supportsMultipleEditorsPerDocument: true }),
    vscode.commands.registerCommand('nib.openInApp', (uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri ?? activeCustomUri();
      if (!target) return;
      if (process.platform === 'darwin') execFile('open', ['-a', 'nib', target.fsPath], (err) => { if (err) vscode.window.showErrorMessage('The nib app is not installed.'); });
      else vscode.window.showInformationMessage('The nib app is for macOS; the design is open here.');
    }),
    vscode.commands.registerCommand('nib.openAsText', (uri) => {
      const target = uri ?? activeCustomUri();
      if (target) vscode.commands.executeCommand('vscode.openWith', target, 'default');
    }),
  );
}

/** The .pen file of the active nib tab. */
function activeCustomUri() {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  return tab && tab.input instanceof vscode.TabInputCustom ? tab.input.uri : undefined;
}

function deactivate() {}

module.exports = { activate, deactivate };
