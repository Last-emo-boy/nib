import { createHmac } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { gatewaySigned } from '../src/auth.ts';
import { startServer } from '../src/server.ts';
import { Siteflow } from '../src/siteflow.ts';
import { Sites } from '../src/store.ts';

const KEY = 'test-gateway-key';
const sig = (sub: string, groups = '', now = Date.now()) => createHmac('sha256', KEY).update(`${sub}\n${groups}\n${Math.floor(now / 60000)}`).digest('hex');
const jwt = (claims: Record<string, unknown>) => ['{"alg":"RS256"}', JSON.stringify(claims), 'sig'].map((p, i) => (i < 2 ? Buffer.from(p).toString('base64url') : p)).join('.');
const b64 = (s: string) => Buffer.from(s).toString('base64');

/** A Siteflow that keeps uploaded files by host and serves them for that Host header. */
function fakeSiteflow() {
  const hosts = new Map<string, Map<string, string>>();
  const archived: string[] = [];
  let n = 0;
  const server = createServer(async (req, res) => {
    if (req.url === '/api/deployments/prebuilt' && req.method === 'POST') {
      if (req.headers.authorization !== 'Bearer root') { res.writeHead(401).end('{}'); return; }
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const host = `${body.requestedHostPrefix}.w33d.xyz`;
      if (hosts.has(host)) { res.writeHead(500).end('{"error":"duplicate host"}'); return; }
      hosts.set(host, new Map(body.files.map((f: { path: string; contentBase64: string }) => [f.path, Buffer.from(f.contentBase64, 'base64').toString()])));
      res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ deploymentId: `d${++n}`, projectId: `p-${body.projectSlug}`, previewHost: host, fileCount: body.files.length, totalBytes: 10 }));
      return;
    }
    if (req.method === 'DELETE' && req.url?.startsWith('/api/projects/')) { archived.push(decodeURIComponent(req.url.slice(14))); res.writeHead(200).end('{}'); return; }
    const files = hosts.get(String(req.headers.host));
    const path = (req.url ?? '/').split('?')[0].replace(/^\//, '') || 'index.html';
    const body = files?.get(path) ?? files?.get(`${path}.html`);
    if (body === undefined) { res.writeHead(404).end('missing'); return; }
    res.writeHead(200, { 'content-type': path.endsWith('.png') ? 'image/png' : 'text/html', 'set-cookie': 'x=1' }).end(body);
  });
  return { server, hosts, archived };
}

let publish: Server, siteflow: ReturnType<typeof fakeSiteflow>, base: string;
beforeAll(async () => {
  siteflow = fakeSiteflow();
  await new Promise<void>((r) => siteflow.server.listen(0, '127.0.0.1', () => r()));
  const sfPort = (siteflow.server.address() as { port: number }).port;
  const dir = await mkdtemp(join(tmpdir(), 'nib-publish-'));
  publish = await startServer({ gatewayKey: KEY, audience: 'nib-desktop', publicBase: 'https://nib.w33d.xyz', siteflow: new Siteflow(`http://127.0.0.1:${sfPort}`, 'root', 'nib-publish-test'), sites: new Sites(join(dir, 'sites.json')) }, 0, '127.0.0.1');
  base = `http://127.0.0.1:${(publish.address() as { port: number }).port}`;
});
afterAll(() => { publish.close(); siteflow.server.close(); });

/** A request as Sluice forwards it: a signed identity, and on the API the person's token. */
const as = (sub: string, token = jwt({ sub, aud: 'nib-desktop', exp: Math.floor(Date.now() / 1000) + 3600 })) => ({ 'x-auth-subject': sub, 'x-auth-sig': sig(sub), authorization: `Bearer ${token}` });
const put = (sub: string, slug: string, body: unknown) => fetch(`${base}/api/sites/${slug}`, { method: 'PUT', headers: { ...as(sub), 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('nib-publish', () => {
  it('checks the gateway signature over this minute or the last', () => {
    const now = Date.now();
    expect(gatewaySigned(KEY, 'usr_a', '', sig('usr_a', '', now), now)).toBe(true);
    expect(gatewaySigned(KEY, 'usr_a', '', sig('usr_a', '', now - 60_000), now)).toBe(true);
    expect(gatewaySigned(KEY, 'usr_a', '', sig('usr_a', '', now - 180_000), now)).toBe(false);
    expect(gatewaySigned(KEY, 'usr_b', '', sig('usr_a', '', now), now)).toBe(false);
  });

  it('accepts only tokens issued to nib, for the subject Sluice vouches for', async () => {
    expect((await fetch(`${base}/api/me`, { headers: as('usr_a') })).status).toBe(200);
    expect((await fetch(`${base}/api/me`)).status).toBe(401);
    expect((await fetch(`${base}/api/me`, { headers: as('usr_a', jwt({ sub: 'usr_a', aud: 'sluice-gw', exp: Date.now() / 1000 + 60 })) })).status).toBe(403);
    expect((await fetch(`${base}/api/me`, { headers: as('usr_a', jwt({ sub: 'usr_b', aud: 'nib-desktop', exp: Date.now() / 1000 + 60 })) })).status).toBe(401);
    expect((await fetch(`${base}/api/me`, { headers: { ...as('usr_a'), 'x-auth-sig': '0'.repeat(64) } })).status).toBe(401);
  });

  it('publishes a site, serves it by visibility, updates it, and takes it down', async () => {
    const files = [{ path: 'index.html', contentBase64: b64('<h1>Home</h1><a href="pricing.html">Pricing</a>') }, { path: 'pricing.html', contentBase64: b64('<h1>Pricing</h1>') }];
    const r = await put('usr_a', 'quill', { name: 'Quill', visibility: 'private', files });
    expect(r.status).toBe(201);
    const site = await r.json();
    expect(site).toMatchObject({ slug: 'quill', visibility: 'private', version: 1, url: 'https://nib.w33d.xyz/p/quill/' });

    // Private: not behind the public door; behind the signed-in one for any w33d user.
    expect((await fetch(`${base}/s/quill/`)).status).toBe(404);
    expect((await fetch(`${base}/p/quill/`)).status).toBe(401);
    const page = await fetch(`${base}/p/quill/pricing.html`, { headers: { 'x-auth-subject': 'usr_other', 'x-auth-sig': sig('usr_other') } });
    expect(await page.text()).toBe('<h1>Pricing</h1>');
    expect(page.headers.get('set-cookie')).toBeNull();
    expect(page.headers.get('cache-control')).toBe('private, no-cache');
    expect((await fetch(`${base}/s/quill`, { redirect: 'manual' })).headers.get('location')).toBe('/s/quill/');

    // Public now.
    const pub = await fetch(`${base}/api/sites/quill`, { method: 'PATCH', headers: { ...as('usr_a'), 'content-type': 'application/json' }, body: '{"visibility":"public"}' });
    expect((await pub.json()).url).toBe('https://nib.w33d.xyz/s/quill/');
    expect(await (await fetch(`${base}/s/quill/`)).text()).toContain('<h1>Home</h1>');

    // Someone else cannot take or change the name.
    expect((await put('usr_b', 'quill', { files })).status).toBe(409);
    expect((await fetch(`${base}/api/sites/quill`, { method: 'DELETE', headers: as('usr_b') })).status).toBe(409);

    // A new version gets a host of its own and replaces what is served.
    const v2 = await (await put('usr_a', 'quill', { visibility: 'public', files: [{ path: 'index.html', contentBase64: b64('<h1>Home v2</h1>') }] })).json();
    expect(v2.version).toBe(2);
    expect(await (await fetch(`${base}/s/quill/`)).text()).toBe('<h1>Home v2</h1>');
    expect([...siteflow.hosts.keys()].filter((h) => h.includes('-v'))).toHaveLength(2);
    expect((await (await fetch(`${base}/api/sites`, { headers: as('usr_a') })).json()).sites.map((s: { slug: string }) => s.slug)).toEqual(['quill']);
    expect((await (await fetch(`${base}/api/sites`, { headers: as('usr_b') })).json()).sites).toEqual([]);

    // Down: not served, and the Siteflow project is archived.
    expect((await fetch(`${base}/api/sites/quill`, { method: 'DELETE', headers: as('usr_a') })).status).toBe(200);
    expect((await fetch(`${base}/s/quill/`)).status).toBe(404);
    expect(siteflow.archived).toEqual([expect.stringMatching(/^p-nib-[0-9a-f]{10}$/)]);
  });

  it('refuses bad uploads', async () => {
    expect((await put('usr_a', 'Bad Name', { files: [] })).status).toBe(400);
    expect((await put('usr_a', 'api', { files: [{ path: 'index.html', contentBase64: '' }] })).status).toBe(400);
    expect((await put('usr_a', 'x1', { files: [{ path: 'about.html', contentBase64: '' }] })).status).toBe(400);
    expect((await put('usr_a', 'x1', { files: [{ path: '../index.html', contentBase64: '' }] })).status).toBe(400);
  });
});
