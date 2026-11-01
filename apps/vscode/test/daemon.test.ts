import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { daemonCommand, editorHtml } = require('../src/daemon.js') as { daemonCommand: (s: string, p?: string) => [string, string[], Record<string, string>]; editorHtml: (o: string, t: string, f: string, c: string) => string };

describe('vscode extension', () => {
  it('runs the daemon from the app, a checkout, or PATH', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-vscode-'));
    const app = join(dir, 'nib.app');
    await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true });
    await mkdir(join(app, 'Contents', 'Resources', 'app', 'packages', 'daemon', 'src'), { recursive: true });
    await writeFile(join(app, 'Contents', 'MacOS', 'nib'), '');
    await writeFile(join(app, 'Contents', 'Resources', 'app', 'packages', 'daemon', 'src', 'main.ts'), '');
    expect(daemonCommand(app, 'linux')).toEqual([join(app, 'Contents', 'MacOS', 'nib'), [join(app, 'Contents', 'Resources', 'app', 'packages', 'daemon', 'src', 'main.ts')], { ELECTRON_RUN_AS_NODE: '1' }]);
    const checkout = join(dir, 'nib');
    await mkdir(join(checkout, 'packages', 'daemon', 'src'), { recursive: true });
    await writeFile(join(checkout, 'packages', 'daemon', 'src', 'main.ts'), '');
    expect(daemonCommand(checkout, 'linux')).toEqual(['node', [join(checkout, 'packages', 'daemon', 'src', 'main.ts')], {}]);
    expect(daemonCommand('', 'linux')).toEqual(['nib-daemon', [], {}]);
  });

  it('shows the editor for the file in a frame the policy allows', () => {
    const html = editorHtml('http://127.0.0.1:7451', 'tok"en', '/Users/a/My "design".pen', 'vscode-resource:');
    expect(html).toContain("frame-src http://127.0.0.1:7451;");
    expect(html).toContain('<iframe src="http://127.0.0.1:7451/#t=tok%22en&amp;file=%2FUsers%2Fa%2FMy+%22design%22.pen"');
  });
});
