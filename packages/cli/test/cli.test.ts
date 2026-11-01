import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { serializePen, type PenDocument } from '@nib/format';
import { diffDocs, diffMarkdown, diffText } from '../src/diff.ts';

const run = promisify(execFile);
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));
const nib = (dir: string, ...args: string[]) => run(process.execPath, [MAIN, ...args], { cwd: dir, env: { ...process.env, NIB_HOME: join(dir, 'home') } }).then((r) => ({ ...r, code: 0 }), (e: { stdout: string; stderr: string; code: number }) => e);

const doc = (title: string, extra: object[] = []): PenDocument => ({ version: '2.20', children: [
  { type: 'frame', id: 'home', name: 'Home', x: 0, y: 0, width: 200, height: 100, fill: '#FFFFFF', layout: 'vertical', children: [
    { type: 'text', id: 't', content: title, fontSize: 20, fill: '#111111' }, ...extra,
  ] },
  { type: 'frame', id: 'about', name: 'About', x: 300, y: 0, width: 100, height: 100, fill: '#EEEEEE' },
] } as unknown as PenDocument);

describe('diff', () => {
  it('lists what changed by frame, and frames that only moved', () => {
    const b = doc('Hello there', [{ type: 'rectangle', id: 'r', width: 10, height: 10, fill: '#FF0000' }]);
    (b.children[1] as { x: number }).x = 400;
    b.children.push({ type: 'frame', id: 'new', name: 'Contact', x: 0, y: 200, width: 50, height: 50 } as never);
    const d = diffDocs(doc('Hello'), b);
    expect(d.frames.map((f) => [f.name, f.kind, f.layers.map((l) => `${l.kind} ${l.id}${l.props ? ` ${l.props.join(',')}` : ''}`)])).toEqual([
      ['Contact', 'added', []], ['Home', 'changed', ['changed t content', 'added r']], ['About', 'moved', []],
    ]);
    expect(diffText(d)).toContain('~ Home (changed, 2 layers)');
    expect(diffMarkdown(d, 'Changes', new Map([['home', { before: 'a.png', after: 'b.png', similarity: 0.9 }]]))).toContain('| ![before](a.png) | ![after](b.png) |');
    expect(diffText(diffDocs(doc('x'), doc('x')))).toBe('No changes.');
  });
});

describe('nib', () => {
  it('renders, exports, validates and diffs from the command line', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'nib-cli-'));
    await writeFile(join(dir, 'a.pen'), serializePen(doc('Hello')));
    await writeFile(join(dir, 'b.pen'), serializePen(doc('Goodbye')));
    const r = await nib(dir, 'render', 'a.pen', '--out', 'shots', '--scale', '1');
    expect(r.code).toBe(0);
    expect((await readdir(join(dir, 'shots'))).sort()).toEqual(['about.png', 'home.png']);
    expect((await nib(dir, 'export', 'a.pen', '--format', 'html-css', '--frame', 'home', '--out', 'home.html')).code).toBe(0);
    expect(await readFile(join(dir, 'home.html'), 'utf8')).toContain('Hello');
    const v = await nib(dir, 'validate', 'a.pen');
    expect(v.stdout).toContain('0 errors');
    expect(v.code).toBe(0);
    await writeFile(join(dir, 'bad.pen'), JSON.stringify({ version: '2.20', children: [{ type: 'rectangle', id: 'x', fill: 3 }] }));
    expect((await nib(dir, 'validate', 'bad.pen')).code).toBe(1);
    const d = await nib(dir, 'diff', 'a.pen', 'b.pen', '--images', 'diff', '--markdown', 'diff/summary.md');
    expect(d.stdout).toContain('~ Home (changed, 1 layer)');
    expect((await readdir(join(dir, 'diff'))).sort()).toEqual(['home.after.png', 'home.before.png', 'home.diff.png', 'summary.md']);
    expect(await readFile(join(dir, 'diff', 'summary.md'), 'utf8')).toContain('![after](home.after.png)');
    expect((await nib(dir, 'render', 'a.pen', '--frame', 'Nope')).stderr).toContain('no top-level frame "Nope"; there are: Home, About');
    expect((await nib(dir, 'frobnicate')).code).toBe(2);
  });
});
