import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { validateNode, type Node } from '@nib/format';
import { browserSnapshotUrl, type FontLoader } from '@nib/render';
import type { DocumentHost, Source } from '../host.ts';
import { PAGE_SCRIPT, type PageSample } from '../brand.ts';
import { Cdp } from './cdp.ts';
import { launchChrome, type Chrome } from './chrome.ts';
import { domToPen, MAX_IMPORT } from './dom-import.ts';
import { implementationReport, matchTexts, PAGE_TEXT_SCRIPT, type PageText } from './implementation.ts';

export type BrowserAction = 'load-page' | 'import-to-canvas' | 'screenshot-to-canvas' | 'return-element' | 'return-screenshot' | 'cdp' | 'element-at' | 'check-implementation';

export interface BrowserArgs {
  action: BrowserAction;
  nodeId?: string;
  target?: 'full-page' | 'selection' | 'query';
  querySelector?: string;
  url?: string;
  method?: string;
  params?: Record<string, unknown>;
  /** For element-at (the editor's element picker): a point on the full page, in CSS pixels. */
  point?: { x: number; y: number };
  /** For element-at: go this many elements up from the one at the point. */
  up?: number;
  /** For return-screenshot: the widest the image may be. */
  width?: number;
  /** For check-implementation: the top-level design frame the page at `url` is built from. */
  frameId?: string;
}

export interface BrowserResult {
  text: string;
  /** Base64 PNG/JPEG. */
  images: { data: string; mimeType: string }[];
  isError?: boolean;
}

interface Viewport { width: number; height: number; mobile: boolean; dpr: number }

/** Device sizes for browser nodes that name one in `deviceId` instead of a fixed size. */
const DEVICES: Record<string, Viewport> = {
  desktop: { width: 1440, height: 900, mobile: false, dpr: 1 },
  laptop: { width: 1280, height: 800, mobile: false, dpr: 1 },
  tablet: { width: 820, height: 1180, mobile: true, dpr: 2 },
  ipad: { width: 820, height: 1180, mobile: true, dpr: 2 },
  iphone: { width: 393, height: 852, mobile: true, dpr: 3 },
  mobile: { width: 393, height: 852, mobile: true, dpr: 3 },
  android: { width: 412, height: 915, mobile: true, dpr: 2.625 },
};

interface Page { key: string; sessionId: string; targetId: string; url?: string; viewport: Viewport; node?: { doc: string; id: string } }

/** CDP domains the `cdp` action may use: enough to act in a page, nothing that reaches the browser or its data. */
const CDP_DOMAINS = new Set(['DOM', 'Input', 'Page', 'Runtime', 'Emulation', 'CSS', 'Accessibility']);
const SHOT_WIDTH = 1568;

const fail = (text: string): BrowserResult => ({ text, images: [], isError: true });

/** Generic and system font names, and the families nib draws them with. */
const GENERIC_FONTS: Record<string, string> = { 'system-ui': 'Inter', '-apple-system': 'Inter', blinkmacsystemfont: 'Inter', 'sans-serif': 'Inter', 'ui-sans-serif': 'Inter', 'segoe ui': 'Inter', roboto: 'Roboto', serif: 'Noto Serif', 'ui-serif': 'Noto Serif', monospace: 'JetBrains Mono', 'ui-monospace': 'JetBrains Mono', sfmono: 'JetBrains Mono', 'sfmono-regular': 'JetBrains Mono', menlo: 'JetBrains Mono', monaco: 'JetBrains Mono', consolas: 'JetBrains Mono' };

/**
 * The `browser` tool: pages in a headless Chrome with nib's own profile, one per browser node (or one
 * shared page when no node is named), read as screenshots or DOM, imported as layers, driven over CDP.
 */
export class BrowserService {
  private host: DocumentHost;
  private fonts: FontLoader | undefined;
  private fontCache = new Map<string, Promise<boolean>>();
  private profileDir: string;
  private snapshotDir: string;
  private chrome?: Chrome;
  private connecting?: Promise<Cdp>;
  private pages = new Map<string, Page>();
  /** Snapshots already loaded in the background (or tried and failed), so a failure is not retried on every render. */
  private tried = new Set<string>();

  constructor(opts: { host: DocumentHost; home: string; fonts?: FontLoader }) {
    this.host = opts.host;
    this.fonts = opts.fonts;
    this.profileDir = join(opts.home, 'browser-profile');
    this.snapshotDir = join(opts.home, 'browser-snapshots');
  }

  /** `agent` names who asked, for the document changes the action makes. */
  async run(filePath: string, args: BrowserArgs, agent = 'browser'): Promise<BrowserResult> {
    try {
      switch (args.action) {
        case 'load-page': return await this.load(filePath, args, agent);
        case 'return-screenshot': return await this.screenshot(filePath, args);
        case 'return-element': return await this.element(filePath, args);
        case 'import-to-canvas': return await this.importToCanvas(filePath, args, agent);
        case 'screenshot-to-canvas': return await this.screenshotToCanvas(filePath, args, agent);
        case 'cdp': return await this.cdpCall(filePath, args);
        case 'element-at': return await this.elementAt(filePath, args);
        case 'check-implementation': return await this.checkImplementation(filePath, args);
        default: return fail(`unknown action ${JSON.stringify(args.action)}; use load-page, import-to-canvas, screenshot-to-canvas, return-element, return-screenshot, cdp or check-implementation`);
      }
    } catch (e) {
      return fail(`browser ${args.action}: ${(e as Error).message}`);
    }
  }

  /**
   * The latest snapshot of a browser node's page at `url` (JPEG), for drawing the node on the canvas.
   * When there is none yet (a document made elsewhere, a url set by hand) the page is loaded in the
   * background, once, and its snapshot announced like any other.
   */
  async snapshot(docPath: string, nodeId: string, url: string): Promise<Uint8Array | undefined> {
    const doc = resolvePath(docPath);
    const bytes = await readFile(this.snapshotFile(doc, nodeId, url)).catch(() => undefined);
    if (bytes) return new Uint8Array(bytes);
    const key = `${doc}#${nodeId}@${url}`;
    // Only for documents open here: thumbnails of other files do not start a browser.
    if (url && !this.tried.has(key) && this.host.list().some((d) => d.path === doc)) {
      this.tried.add(key);
      void (async () => {
        const page = await this.page(doc, nodeId);
        if (page.url !== url) await this.navigate(page, url);
        await this.saveSnapshot(page, url);
      })().catch((e: Error) => process.stderr.write(`nib: could not load ${url} for browser node ${nodeId}: ${e.message}\n`));
    }
    return undefined;
  }

  /**
   * What a website shows of its brand: colors of its buttons, links and declared brand variables, and its
   * text font when nib can load it (absent for system fonts). Uses a page of its own.
   */
  async readBrand(url: string): Promise<{ sample: PageSample; font?: string }> {
    const page = await this.page('', undefined, 'brand');
    await this.navigate(page, url);
    // A page that is still replacing its document (a client-side redirect) is read again a moment later.
    let sample: PageSample | null = null;
    for (let i = 0; i < 3 && !sample; i++) {
      if (i) await new Promise((res) => setTimeout(res, 1500));
      sample = await this.evaluate<PageSample | null>(page, PAGE_SCRIPT).catch(() => null);
    }
    if (!sample) throw new Error(`could not read ${url}`);
    let font: string | undefined;
    for (const raw of sample.body.font.split(',')) {
      const name = raw.trim().replace(/^["']|["']$/g, '');
      if (!name) continue;
      // A system font (system-ui, Segoe UI): the brand has no font of its own to carry over.
      const generic = GENERIC_FONTS[name.toLowerCase()];
      if (generic && generic !== name) break;
      const plain = name.replace(/\s+(VF|Variable|Var)$/i, '');
      // Some sites name their font in lower case ("inter"); families are written capitalized.
      if (await this.fontAvailable(name)) { font = name === name.toLowerCase() ? name.replace(/\b\w/g, (c) => c.toUpperCase()) : name; break; }
      if (plain !== name && (await this.fontAvailable(plain))) { font = plain; break; }
    }
    return { sample, ...(font ? { font } : {}) };
  }

  close(): void {
    this.chrome?.process.kill();
    this.chrome = undefined;
    this.connecting = undefined;
    this.pages.clear();
  }

  private async cdp(): Promise<Cdp> {
    const current = this.connecting && (await this.connecting.catch(() => undefined));
    if (current && !current.closed) return current;
    this.pages.clear();
    this.connecting = (async () => {
      if (!this.chrome || this.chrome.process.exitCode !== null) this.chrome = await launchChrome(this.profileDir);
      return Cdp.connect(this.chrome.wsUrl);
    })();
    return this.connecting;
  }

  /**
   * The page at `url` (a running app, often on localhost) against the design frame it is built from: loaded
   * in a window as wide as the frame, compared pixel by pixel and text by text, with what to change.
   */
  private async checkImplementation(filePath: string, args: BrowserArgs): Promise<BrowserResult> {
    if (!args.url) return fail('check-implementation needs the url of the page');
    if (!args.frameId) return fail('check-implementation needs frameId: the top-level design frame the page is built from');
    const open = await this.host.open(filePath);
    const frame = open.session.doc.get(args.frameId);
    if (!frame || open.session.doc.locate(args.frameId)?.parent) return fail(`"${args.frameId}" is not a top-level frame of this document`);
    const b = open.session.box(args.frameId);
    if (!b) return fail(`"${args.frameId}" has no size yet`);
    const width = Math.round(b.width), height = Math.round(b.height);
    const page = await this.page('', undefined, 'implementation', { width, height, mobile: width < 600, dpr: 1 });
    const url = await this.navigate(page, args.url);
    const texts = await this.evaluate<PageText[]>(page, PAGE_TEXT_SCRIPT);
    const shot = await this.capture(page, { action: 'return-screenshot' }, undefined);
    const facts = await this.host.implementationFacts(open.path, args.frameId, new Uint8Array(Buffer.from(shot.data, 'base64')));
    const report = implementationReport({ url, frame: { id: args.frameId, name: String(frame.name ?? args.frameId) }, pixels: facts.pixels, match: matchTexts(facts.texts, texts) });
    return { text: report, images: [{ data: Buffer.from(facts.pixels.diff).toString('base64'), mimeType: 'image/png' }] };
  }

  /** The page for a browser node (sized like it), or a shared page (`size`: its window, else a desktop's). */
  private async page(filePath: string, nodeId: string | undefined, shared = 'shared', size?: Viewport): Promise<Page> {
    const cdp = await this.cdp();
    let viewport = size ?? DEVICES.desktop;
    let key = shared;
    if (nodeId) {
      const node = await this.browserNode(filePath, nodeId);
      key = `${resolvePath(filePath)}#${nodeId}`;
      const device = typeof node.deviceId === 'string' ? DEVICES[node.deviceId.toLowerCase()] : undefined;
      const w = typeof node.width === 'number' ? node.width : device?.width ?? 1280;
      const h = typeof node.height === 'number' ? node.height : device?.height ?? 800;
      viewport = { width: Math.round(w), height: Math.round(h), mobile: device?.mobile ?? false, dpr: device?.dpr ?? 1 };
    }
    let page = this.pages.get(key);
    if (!page) {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      for (const domain of ['Page', 'Runtime', 'DOM']) await cdp.send(`${domain}.enable`, {}, sessionId);
      await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
      page = { key, sessionId, targetId, viewport: { ...viewport, width: 0 }, ...(nodeId ? { node: { doc: resolvePath(filePath), id: nodeId } } : {}) };
      this.pages.set(key, page);
    }
    if (page.viewport.width !== viewport.width || page.viewport.height !== viewport.height || page.viewport.mobile !== viewport.mobile) {
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: viewport.dpr, mobile: viewport.mobile }, page.sessionId);
      page.viewport = viewport;
    }
    return page;
  }

  private async browserNode(filePath: string, nodeId: string): Promise<Record<string, unknown>> {
    const open = await this.host.open(filePath);
    const node = open.session.doc.get(nodeId) as Record<string, unknown> | undefined;
    if (!node) throw new Error(`node "${nodeId}" not found`);
    if (node.type !== 'browser') throw new Error(`"${nodeId}" is a ${node.type}, not a browser node`);
    return node;
  }

  private async loadedPage(filePath: string, nodeId: string | undefined): Promise<Page> {
    const page = await this.page(filePath, nodeId);
    if (!page.url) {
      const node = nodeId ? await this.browserNode(filePath, nodeId) : undefined;
      if (typeof node?.url === 'string' && node.url) await this.navigate(page, node.url);
      else throw new Error('no page is loaded here yet; call load-page with a url first');
    }
    return page;
  }

  private async navigate(page: Page, url: string): Promise<string> {
    if (!/^(https?|file):/.test(url)) throw new Error('url must start with http://, https:// or file://');
    const cdp = await this.cdp();
    const loaded = cdp.waitFor('Page.loadEventFired', page.sessionId, 30_000);
    const r = await cdp.send('Page.navigate', { url }, page.sessionId);
    if (r.errorText) throw new Error(`could not load ${url}: ${r.errorText}`);
    await loaded;
    // Give late requests (fonts, images, client rendering) a moment.
    await cdp.waitFor('Page.lifecycleEvent', page.sessionId, 4000).then(() => new Promise((res) => setTimeout(res, 600)));
    const { result } = await cdp.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true }, page.sessionId);
    page.url = result.value ?? url;
    return page.url!;
  }

  private async evaluate<T>(page: Page, expression: string): Promise<T> {
    const cdp = await this.cdp();
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, page.sessionId, 120_000);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value as T;
  }

  /** The element an action targets, as a JS expression in the page. */
  private targetExpression(args: BrowserArgs): string {
    if (args.target === 'selection') throw new Error('no element is selected: the element picker belongs to the nib editor\'s browser panel; use target "query" with a querySelector');
    if (args.target === 'query') {
      if (!args.querySelector) throw new Error('target "query" needs a querySelector');
      return `document.querySelector(${JSON.stringify(args.querySelector)})`;
    }
    return 'document.documentElement';
  }

  private async load(filePath: string, args: BrowserArgs, agent: string): Promise<BrowserResult> {
    if (!args.url) return fail('load-page needs a url');
    const page = await this.page(filePath, args.nodeId);
    const url = await this.navigate(page, args.url);
    const title = await this.evaluate<string>(page, 'document.title');
    if (args.nodeId) {
      // Stored under the page's final url first, so editors find it when the node's url changes to it.
      await this.saveSnapshot(page, url);
      const node = await this.browserNode(filePath, args.nodeId);
      if (node.url !== url) await this.host.execute(filePath, { input: `Update(${JSON.stringify(args.nodeId)}, {url: ${JSON.stringify(url)}})` }, agent);
    }
    return { text: `Loaded ${url}${title ? ` — "${title}"` : ''}${args.nodeId ? ` in browser node ${args.nodeId} (${page.viewport.width}×${page.viewport.height})` : ` (${page.viewport.width}×${page.viewport.height})`}.`, images: [] };
  }

  private async capture(page: Page, args: BrowserArgs, maxWidth: number | undefined): Promise<{ data: string; width: number; height: number }> {
    const cdp = await this.cdp();
    let clip: { x: number; y: number; width: number; height: number };
    if (args.target === 'query' || args.target === 'selection') {
      const r = await this.evaluate<{ x: number; y: number; width: number; height: number } | null>(page, `(() => { const el = ${this.targetExpression(args)}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);
      if (!r) throw new Error(`no element matches ${JSON.stringify(args.querySelector)}`);
      if (r.width < 1 || r.height < 1) throw new Error(`${args.querySelector} has no visible size`);
      clip = r;
    } else {
      const m = await cdp.send('Page.getLayoutMetrics', {}, page.sessionId);
      const size = m.cssContentSize ?? m.contentSize;
      clip = { x: 0, y: 0, width: size.width, height: Math.min(size.height, 16_000) };
    }
    const scale = maxWidth ? Math.min(1, maxWidth / clip.width) : 1;
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...clip, scale }, captureBeyondViewport: true }, page.sessionId, 120_000);
    return { data: shot.data, width: clip.width, height: clip.height };
  }

  private async screenshot(filePath: string, args: BrowserArgs): Promise<BrowserResult> {
    const page = await this.loadedPage(filePath, args.nodeId);
    const shot = await this.capture(page, args, Math.min(SHOT_WIDTH, args.width ?? SHOT_WIDTH));
    return { text: `Screenshot of ${args.target === 'query' ? args.querySelector : 'the full page'} on ${page.url} (${Math.round(shot.width)}×${Math.round(shot.height)}).`, images: [{ data: shot.data, mimeType: 'image/png' }] };
  }

  /** The element at a point of the page, as a selector and its box: JSON in `text`. */
  private async elementAt(filePath: string, args: BrowserArgs): Promise<BrowserResult> {
    if (!args.point || !Number.isFinite(args.point.x) || !Number.isFinite(args.point.y)) return fail('element-at needs a point {x, y}');
    const page = await this.loadedPage(filePath, args.nodeId);
    const r = await this.evaluate<unknown>(page, `(${elementAtPoint.toString()})(${args.point.x}, ${args.point.y}, ${Math.max(0, Math.floor(args.up ?? 0))})`);
    return r ? { text: JSON.stringify(r), images: [] } : fail('there is no element at that point');
  }

  private async element(filePath: string, args: BrowserArgs): Promise<BrowserResult> {
    const page = await this.loadedPage(filePath, args.nodeId);
    const target = args.target === 'full-page' || !args.target ? 'document.body' : this.targetExpression(args);
    const text = await this.evaluate<string>(page, `(${describeElement.toString()})(${target})`);
    return { text, images: [] };
  }

  private async importToCanvas(filePath: string, args: BrowserArgs, agent: string): Promise<BrowserResult> {
    const page = await this.loadedPage(filePath, args.nodeId);
    const fullPage = args.target !== 'query' && args.target !== 'selection';
    const root = fullPage ? 'document.documentElement' : this.targetExpression(args);
    const r = await this.evaluate<{ node: Record<string, unknown>; count: number; truncated: boolean } | null>(page, `(() => { const root = ${root}; return root ? (${domToPen.toString()})(root, ${JSON.stringify({ maxNodes: MAX_IMPORT, fullPage })}) : null; })()`);
    if (!r) return fail(`no element matches ${JSON.stringify(args.querySelector)}`);
    const nearNode = args.nodeId && !(await this.host.open(filePath)).session.doc.locate(args.nodeId)?.parent ? args.nodeId : undefined;
    const placed = await this.importCaptured(filePath, r.node, agent, nearNode);
    if ('error' in placed) return fail(placed.error);
    const { id, node, width, height } = placed;
    return {
      text: `Imported ${page.url}${fullPage ? '' : ` (${args.querySelector})`} as frame "${id}" ("${node.name}", ${width}×${height}) with ${r.count} layers${r.truncated ? `, stopping at ${MAX_IMPORT}` : ''}. Each layer's "context" holds the source element's tag, prefixed with its component name when found. Edit it with execute like any other frame.`,
      images: [],
    };
  }

  /**
   * A page or element captured with domToPen (here, or in the person's own browser by nib's extension) into
   * the document as a frame in free space (near `near` when given), its fonts mapped to ones nib has.
   */
  async importCaptured(filePath: string, captured: Record<string, unknown>, agent: string, near?: string, as?: { source: Source; label: string }): Promise<{ id: string; node: Record<string, unknown>; width: number; height: number } | { error: string }> {
    await this.resolveFonts(captured);
    const node = sanitize(captured);
    const width = Math.round(node.width as number), height = Math.round(node.height as number);
    const snippet = `const at = FindEmptySpace({width: ${width}, height: ${height}, padding: 120${near ? `, nodeId: ${JSON.stringify(near)}` : ''}})\nconst node = ${JSON.stringify(node)}\nnode.x = at.x; node.y = at.y\nPrint(Insert(document, node))`;
    const res = await this.host.execute(filePath, { input: snippet }, agent, as);
    if (!res.ok) return { error: `the import did not fit the document: ${res.text.split('\n').slice(0, 6).join('\n')}` };
    return { id: /## Print output\n(\S+)/.exec(res.text)?.[1] ?? '?', node, width, height };
  }

  private async screenshotToCanvas(filePath: string, args: BrowserArgs, agent: string): Promise<BrowserResult> {
    const page = await this.loadedPage(filePath, args.nodeId);
    const shot = await this.capture(page, args, undefined);
    const dir = join(dirname(resolvePath(filePath)), 'images');
    await mkdir(dir, { recursive: true });
    const host = (() => { try { return new URL(page.url!).hostname.replace(/[^a-z0-9.-]/gi, '') || 'page'; } catch { return 'page'; } })();
    const name = `screenshot-${host}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.png`;
    await writeFile(join(dir, name), Buffer.from(shot.data, 'base64'));
    const w = Math.round(shot.width), h = Math.round(shot.height);
    const res = await this.host.execute(filePath, { input: `const at = FindEmptySpace({width: ${w}, height: ${h}, padding: 120})\nPrint(Insert(document, {type: "rectangle", name: ${JSON.stringify(`Screenshot · ${host}`)}, x: at.x, y: at.y, width: ${w}, height: ${h}, fill: {type: "image", url: ${JSON.stringify(`images/${name}`)}, mode: "cover"}}))` }, agent);
    if (!res.ok) return fail(res.text);
    const id = /## Print output\n(\S+)/.exec(res.text)?.[1] ?? '?';
    return { text: `Placed a screenshot of ${page.url} as "${id}" (${w}×${h}); the image is saved as images/${name} next to the document.`, images: [] };
  }

  private async cdpCall(filePath: string, args: BrowserArgs): Promise<BrowserResult> {
    if (!args.method) return fail('cdp needs a method, e.g. "Runtime.evaluate"');
    const domain = args.method.split('.')[0];
    if (!CDP_DOMAINS.has(domain)) return fail(`the ${domain} domain is not available; use DOM, Input, Page, Runtime, Emulation, CSS or Accessibility`);
    const page = await this.loadedPage(filePath, args.nodeId);
    const cdp = await this.cdp();
    const navigates = args.method === 'Page.navigate' || args.method === 'Page.reload' || args.method === 'Input.dispatchMouseEvent';
    const loaded = navigates ? cdp.waitFor('Page.loadEventFired', page.sessionId, 5000) : undefined;
    const result = await cdp.send(args.method, args.params ?? {}, page.sessionId, 60_000);
    if (loaded) await loaded;
    if (args.nodeId) await this.saveSnapshot(page);
    if (args.method === 'Page.captureScreenshot' && typeof result?.data === 'string') {
      return { text: `${args.method} on ${page.url}`, images: [{ data: result.data, mimeType: `image/${(args.params?.format as string) ?? 'png'}` }] };
    }
    const text = JSON.stringify(result ?? {}, null, 1);
    return { text: text.length > 50_000 ? `${text.slice(0, 50_000)}\n… (cut at 50000 characters)` : text, images: [] };
  }

  /**
   * Imported text names its page's whole font stack; use the first family nib can load (web fonts are
   * often named "X VF" or "X Variable"; generic names map to families nib has).
   */
  private fontAvailable(family: string): Promise<boolean> {
    let p = this.fontCache.get(family);
    if (!p) {
      p = this.fonts ? this.fonts.load({ family, weight: 400, italic: false }).then((b) => !!b, () => false) : Promise.resolve(false);
      this.fontCache.set(family, p);
    }
    return p;
  }

  private async resolveFonts(node: Record<string, unknown>): Promise<void> {
    const pick = async (stack: string): Promise<string | undefined> => {
      for (const raw of stack.split(',')) {
        const name = raw.trim().replace(/^["']|["']$/g, '');
        if (!name) continue;
        const mapped = GENERIC_FONTS[name.toLowerCase()];
        if (mapped) return mapped;
        for (const candidate of [name, name.replace(/\s+(VF|Variable|Var)$/i, '')]) if (await this.fontAvailable(candidate)) return candidate;
      }
      return undefined;
    };
    const picks = new Map<string, Promise<string | undefined>>();
    const visit = async (n: Record<string, unknown>) => {
      if (typeof n.fontStack === 'string') {
        let p = picks.get(n.fontStack);
        if (!p) picks.set(n.fontStack, (p = pick(n.fontStack)));
        const family = await p;
        if (family) n.fontFamily = family;
        delete n.fontStack;
      }
      for (const c of (n.children as Record<string, unknown>[] | undefined) ?? []) await visit(c);
    };
    await visit(node);
  }

  /** Store what a browser node's page shows, for the canvas, under `url` (default: the node's url). */
  private async saveSnapshot(page: Page, url?: string): Promise<void> {
    if (!page.node) return;
    const { doc, id } = page.node;
    const node = (await this.host.open(doc)).session.doc.get(id) as { id: string; url?: unknown } | undefined;
    if (!node) return;
    const at = url ?? (typeof node.url === 'string' ? node.url : '');
    const cdp = await this.cdp();
    const shot = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 85 }, page.sessionId);
    await mkdir(this.snapshotDir, { recursive: true });
    await writeFile(this.snapshotFile(doc, id, at), Buffer.from(shot.data, 'base64'));
    this.host.assetChanged(doc, browserSnapshotUrl({ id, url: at }));
  }

  private snapshotFile(doc: string, nodeId: string, url: string): string {
    return join(this.snapshotDir, `${createHash('sha1').update(`${doc}#${nodeId}@${url}`).digest('hex')}.jpg`);
  }
}

/** Drop properties the .pen schema rejects, node by node, so one odd style does not sink an import. */
function sanitize(node: Record<string, unknown>): Record<string, unknown> {
  const clean = (n: Record<string, unknown>) => {
    for (const issue of validateNode(n as unknown as Node, { strict: true, deep: false })) {
      if (issue.level !== 'error') continue;
      const prop = issue.path.split('.').slice(1).join('.').replace(/\[.*$/, '');
      if (prop && prop !== 'type' && prop !== 'children') delete n[prop];
    }
    for (const c of (n.children as Record<string, unknown>[] | undefined) ?? []) clean(c);
  };
  clean(node);
  return node;
}

// Runs inside the page: an element and its descendants as text, with the computed styles that matter for a design.
function describeElement(el: Element | null): string {
  if (!el) return 'No element matches.';
  const KEYS = ['display', 'position', 'flexDirection', 'justifyContent', 'alignItems', 'gap', 'gridTemplateColumns', 'width', 'height', 'padding', 'margin', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color', 'backgroundColor', 'backgroundImage', 'border', 'borderRadius', 'boxShadow', 'opacity'];
  const SKIP: Record<string, string> = { display: 'inline', position: 'static', gap: 'normal', margin: '0px', padding: '0px', backgroundColor: 'rgba(0, 0, 0, 0)', backgroundImage: 'none', borderRadius: '0px', boxShadow: 'none', opacity: '1', letterSpacing: 'normal', gridTemplateColumns: 'none', justifyContent: 'normal', alignItems: 'normal', flexDirection: 'row' };
  const lines: string[] = [];
  let count = 0;
  const visit = (e: Element, depth: number) => {
    if (count++ > 250) return;
    const cs = getComputedStyle(e);
    if (cs.display === 'none') return;
    const r = e.getBoundingClientRect();
    const attrs = [e.id && `#${e.id}`, typeof (e as HTMLElement).className === 'string' && (e as HTMLElement).className.trim() && `.${(e as HTMLElement).className.trim().split(/\s+/).slice(0, 4).join('.')}`].filter(Boolean).join('');
    const styles = KEYS.map((k) => [k, (cs as unknown as Record<string, string>)[k]] as const).filter(([k, v]) => v && v !== SKIP[k] && !(k === 'border' && v.startsWith('0px'))).map(([k, v]) => `${k}: ${v}`).join('; ');
    const text = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent?.trim()).filter(Boolean).join(' ').slice(0, 120);
    lines.push(`${'  '.repeat(depth)}<${e.tagName.toLowerCase()}${attrs}> ${Math.round(r.width)}×${Math.round(r.height)} at (${Math.round(r.left + scrollX)}, ${Math.round(r.top + scrollY)})${text ? ` "${text}"` : ''}${styles ? `\n${'  '.repeat(depth)}  { ${styles} }` : ''}`);
    for (const c of Array.from(e.children)) visit(c, depth + 1);
  };
  visit(el, 0);
  if (count > 250) lines.push('… (cut at 250 elements; narrow the target with a querySelector)');
  return lines.join('\n');
}

/**
 * Runs in the page: the element at (x, y) on the full page (or `up` elements above it), with a selector
 * that finds it again and its box on the page.
 */
function elementAtPoint(x: number, y: number, up: number) {
  window.scrollTo(0, Math.max(0, y - innerHeight / 2));
  let el = document.elementFromPoint(x - scrollX, y - scrollY);
  for (let i = 0; i < up && el && el.parentElement && el.parentElement !== document.documentElement; i++) el = el.parentElement;
  if (!el) return null;
  const unique = (sel: string) => document.querySelectorAll(sel).length === 1;
  const parts: string[] = [];
  for (let c: Element | null = el; c && c !== document.documentElement; c = c.parentElement) {
    if (c.id && unique(`#${CSS.escape(c.id)}`)) { parts.unshift(`#${CSS.escape(c.id)}`); break; }
    const tag = c.tagName.toLowerCase();
    const same = c.parentElement ? [...c.parentElement.children].filter((s) => s.tagName === c!.tagName) : [];
    parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(c) + 1})` : tag);
  }
  const r = el.getBoundingClientRect();
  return { selector: parts.join(' > '), tag: el.tagName.toLowerCase(), rect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height } };
}
