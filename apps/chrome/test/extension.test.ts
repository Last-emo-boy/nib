import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializePen, type PenDocument } from '../../../packages/format/src/index.ts';
import { createNodeRenderer, PackageIconSource } from '../../../packages/render/src/node.ts';
import { BrowserService, DocumentHost, startDaemon, type Daemon } from '../../../packages/daemon/src/index.ts';
import { launchChrome, type Chrome } from '../../../packages/daemon/src/browser/chrome.ts';
import { Cdp } from '../../../packages/daemon/src/browser/cdp.ts';
import { buildExtension, captureScript } from '../src/build.ts';

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), 'nib-chrome-')); });
afterAll(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 5 }); });

describe('chrome extension', () => {
  it('builds with every message in both languages and every file the manifest names', async () => {
    const out = join(dir, 'ext');
    await buildExtension(out);
    const manifest = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe(JSON.parse(await readFile('apps/desktop/package.json', 'utf8')).version);
    for (const f of [manifest.action.default_popup, ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), 'capture.js', 'popup.js']) expect(existsSync(join(out, f as string)), f as string).toBe(true);
    expect(existsSync(join(out, 'page.js'))).toBe(false);
    const en = JSON.parse(await readFile(join(out, '_locales/en/messages.json'), 'utf8'));
    const zh = JSON.parse(await readFile(join(out, '_locales/zh_CN/messages.json'), 'utf8'));
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
    const text = [JSON.stringify(manifest), ...(await Promise.all(['popup.html', 'popup.js', 'capture.js'].map((f) => readFile(join(out, f), 'utf8'))))].join('\n');
    // Keys in the manifest and popup markup, and every quoted word in a t(…) call (t(a ? 'x' : 'y', n) too).
    const calls = [...text.matchAll(/\bt\(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((q) => q[1]));
    const used = new Set([...[...text.matchAll(/__MSG_(\w+)__|data-msg="(\w+)"/g)].map((m) => m[1] ?? m[2]), ...calls]);
    for (const key of used) expect(en[key], key).toBeDefined();
    for (const key of ['copied', 'copiedSome', 'cannotRead', 'pickHint']) expect(used.has(key), key).toBe(true);
  });

  describe('in a page', () => {
    let chrome: Chrome;
    let cdp: Cdp;
    let session: string;
    const evaluate = async <T>(expression: string): Promise<T> => {
      const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value as T;
    };
    const mouse = (type: string, x: number, y: number) => cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, session);

    beforeAll(async () => {
      chrome = await launchChrome(join(dir, 'profile'));
      cdp = await Cdp.connect(chrome.wsUrl);
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      session = (await cdp.send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
      await cdp.send('Page.enable', {}, session);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }, session);
      const html = `<body style="margin:0;font-family:sans-serif"><section id="card" style="margin:40px;padding:20px;width:300px;background:#eef;border-radius:12px"><h2 style="margin:0">Pricing</h2><p id="price" style="background:#fff;padding:8px">$12 a month</p><a href="#gone">Buy</a></section></body>`;
      const loaded = cdp.waitFor('Page.loadEventFired', session, 5000);
      await cdp.send('Page.navigate', { url: `data:text/html,${encodeURIComponent(html)}` }, session);
      await loaded;
      // What the extension's isolated world has: chrome.i18n, and a clipboard (here one that remembers).
      await evaluate(`Object.defineProperty(globalThis, 'chrome', { value: { i18n: { getMessage: (k, s) => [k, ...s].join(' ') } } });
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { globalThis.copied = t; } } });`);
      const script = await captureScript();
      await evaluate(script);
      await evaluate(script); // the popup injects it on every use
    }, 30_000);
    afterAll(async () => {
      cdp?.close();
      if (chrome && chrome.process.exitCode === null) { const exited = once(chrome.process, 'exit'); chrome.process.kill(); await exited; }
    });

    it('copies the whole page as nib clipboard content', async () => {
      const r = await evaluate<{ text: string; count: number; truncated: boolean }>('globalThis.__nibCopy.page()');
      const clip = JSON.parse(r.text);
      expect(clip.nib).toBe('dom');
      expect(clip.url).toMatch(/^data:text\/html/);
      expect(r.count).toBeGreaterThan(3);
      expect(r.truncated).toBe(false);
      expect(JSON.stringify(clip.node)).toContain('$12 a month');
    });

    it('picks the element under the pointer, its parent with ↑, and copies it on click', async () => {
      await evaluate('globalThis.__nibCopy.pick()');
      const price = await evaluate<{ x: number; y: number }>(`(() => { const r = document.getElementById('price').getBoundingClientRect(); return { x: r.x + 10, y: r.y + 10 }; })()`);
      await mouse('mouseMoved', price.x, price.y);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38 }, session);
      await mouse('mousePressed', price.x, price.y);
      await mouse('mouseReleased', price.x, price.y);
      let text: string | undefined;
      for (let i = 0; i < 50 && !text; i++) { text = await evaluate<string | undefined>('globalThis.copied'); if (!text) await new Promise((r) => setTimeout(r, 50)); }
      const clip = JSON.parse(text!);
      // The section (340 wide with its padding), not the paragraph, and the page did not follow the link.
      expect(clip.node.width).toBe(340);
      expect(JSON.stringify(clip.node)).toContain('Pricing');
      expect(await evaluate<string>('location.hash')).toBe('');
      expect(await evaluate<number>('document.querySelectorAll("[style*=\\"2147483646\\"]").length')).toBe(0);
    });

    it('pastes into a document through the daemon as an undoable change', async () => {
      const page = JSON.parse((await evaluate<{ text: string }>('globalThis.__nibCopy.page()')).text);
      const file = join(dir, 'paste.pen');
      await writeFile(file, serializePen({ version: '2.20', children: [{ type: 'frame', id: 'a', x: 0, y: 0, width: 100, height: 100 }] } as unknown as PenDocument));
      const renderer = await createNodeRenderer();
      const host = new DocumentHost({ renderer, images: () => ({ load: async () => undefined }), watch: false, recents: false });
      const none = { load: async () => undefined };
      const daemon: Daemon = await startDaemon({ host, renderer, fonts: none, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0, sharesDir: join(dir, 'shares'), shareBind: '127.0.0.1', browser: new BrowserService({ host, home: dir }) });
      try {
        const post = (body: unknown) => fetch(`http://127.0.0.1:${daemon.port}/api/import-dom`, { method: 'POST', headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        expect((await post({ doc: file })).status).toBe(400);
        const r = await post({ doc: file, node: page.node });
        const j = await r.json() as { id: string; width: number };
        expect(r.status).toBe(200);
        expect(j.width).toBe(800);
        const snap = host.snapshot(file);
        const pasted = snap.data.children.find((n) => n.id === j.id) as { x: number } | undefined;
        expect(pasted).toBeDefined();
        expect(pasted!.x).toBeGreaterThan(100); // in free space, not over the frame already there
        expect(snap.undo.at(-1)).toBe('Paste from the browser');
      } finally {
        await daemon.close();
        host.close();
      }
    }, 30_000);
  });
});
