import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/**
 * Signing in to w33d, and publishing there. nib signs the person in with w33d's SSO (Keystone, OIDC
 * authorization code with PKCE): their browser opens w33d's sign-in, which comes back to this daemon on
 * 127.0.0.1. The access token (an hour; Keystone gives no refresh tokens) is kept where API keys are. With it,
 * nib-publish (nib.w33d.xyz) takes the site nib exported. Nothing else in nib needs the sign-in.
 */

export interface W33dConfig {
  issuer: string;
  clientId: string;
  /** nib-publish's address. */
  publishBase: string;
  /** Where the browser comes back: this daemon. */
  redirectUri: string;
  userAgent: string;
  /** Where the session is kept (the Keychain in nib), as one JSON string. */
  store: { get(): Promise<string | undefined>; set(value: string | undefined): Promise<void> };
  fetch?: typeof fetch;
}

export interface W33dSession { accessToken: string; expiresAt: number; sub: string; email?: string }
export interface W33dStatus { signedIn: boolean; email?: string; expiresAt?: number }
export interface PublishedSite { slug: string; name: string; visibility: 'public' | 'private'; url: string; privateUrl: string; version: number; updated: string }

const b64url = (b: Buffer) => b.toString('base64url');
/** A sign-in started in the browser expires after this long. */
const PENDING_MS = 10 * 60_000;

export class W33dError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export class W33d {
  private cfg: W33dConfig;
  private pending = new Map<string, { verifier: string; nonce: string; at: number }>();
  private fetch: typeof fetch;

  constructor(cfg: W33dConfig) {
    this.cfg = cfg;
    this.fetch = cfg.fetch ?? fetch;
  }

  /** The address that starts signing in, for the person's browser. */
  start(): string {
    const now = Date.now();
    for (const [k, p] of this.pending) if (now - p.at > PENDING_MS) this.pending.delete(k);
    const state = b64url(randomBytes(16)), verifier = b64url(randomBytes(32)), nonce = b64url(randomBytes(16));
    this.pending.set(state, { verifier, nonce, at: now });
    const q = new URLSearchParams({
      response_type: 'code', client_id: this.cfg.clientId, redirect_uri: this.cfg.redirectUri, scope: 'openid email profile',
      state, nonce, code_challenge: b64url(createHash('sha256').update(verifier).digest()), code_challenge_method: 'S256',
    });
    return `${this.cfg.issuer}/authorize?${q}`;
  }

  /** The browser came back with a code: trade it for a token and keep the session. */
  async finish(code: string, state: string): Promise<W33dSession> {
    const p = this.pending.get(state);
    this.pending.delete(state);
    if (!p || Date.now() - p.at > PENDING_MS) throw new W33dError('this sign-in expired or was not started here; start it again from nib');
    const r = await this.fetch(`${this.cfg.issuer}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': this.cfg.userAgent },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: this.cfg.redirectUri, client_id: this.cfg.clientId, code_verifier: p.verifier }),
    });
    const text = await r.text();
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(text); } catch { /* not JSON: an edge page or an error */ }
    if (!r.ok || typeof j.access_token !== 'string') throw new W33dError(`w33d did not sign in: ${r.status} ${String(j.error_description ?? j.error ?? text.slice(0, 120))}`, 502);
    // The id token comes straight from w33d over TLS: read for who signed in (not used to decide access).
    const id = typeof j.id_token === 'string' ? claims(j.id_token) : {};
    if (id.nonce !== undefined && id.nonce !== p.nonce) throw new W33dError('the sign-in answer did not match (nonce)', 502);
    const access = claims(j.access_token);
    const session: W33dSession = {
      accessToken: j.access_token,
      expiresAt: typeof access.exp === 'number' ? access.exp * 1000 : Date.now() + (Number(j.expires_in) || 3600) * 1000,
      sub: String(access.sub ?? id.sub ?? ''),
      ...(typeof id.email === 'string' ? { email: id.email } : {}),
    };
    await this.cfg.store.set(JSON.stringify(session));
    return session;
  }

  private async session(): Promise<W33dSession | undefined> {
    try {
      const raw = await this.cfg.store.get();
      return raw ? (JSON.parse(raw) as W33dSession) : undefined;
    } catch {
      return undefined;
    }
  }

  async status(): Promise<W33dStatus> {
    const s = await this.session();
    return s && s.expiresAt > Date.now() + 30_000 ? { signedIn: true, email: s.email, expiresAt: s.expiresAt } : { signedIn: false, ...(s?.email ? { email: s.email } : {}) };
  }

  async signOut(): Promise<void> {
    await this.cfg.store.set(undefined);
  }

  /** A call to nib-publish as the signed-in person. */
  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const s = await this.session();
    if (!s || s.expiresAt < Date.now() + 30_000) throw new W33dError('sign in to w33d first (the sign-in lasts an hour)', 401);
    const r = await this.fetch(`${this.cfg.publishBase}/api${path}`, {
      method,
      headers: { authorization: `Bearer ${s.accessToken}`, accept: 'application/json', 'user-agent': this.cfg.userAgent, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    let j: Record<string, unknown> = {};
    try { j = JSON.parse(text); } catch { /* an edge page */ }
    if (r.status === 401) await this.signOut();
    if (!r.ok) throw new W33dError(String(j.error ?? (r.status === 401 ? 'sign in to w33d again' : `nib.w33d.xyz answered ${r.status}`)), r.status);
    return j as T;
  }

  /** Publish the site in `dir` (index.html and what it uses) as `slug`. */
  async publish(dir: string, slug: string, name: string, visibility: 'public' | 'private'): Promise<PublishedSite> {
    const files: { path: string; contentBase64: string }[] = [];
    for (const file of await walk(dir)) files.push({ path: relative(dir, file).split('\\').join('/'), contentBase64: (await readFile(file)).toString('base64') });
    const s = await this.session();
    return this.call<PublishedSite>('PUT', `/sites/${encodeURIComponent(slug)}`, { name, visibility, files, ...(s?.email ? { ownerLabel: s.email } : {}) });
  }

  setVisibility(slug: string, visibility: 'public' | 'private'): Promise<PublishedSite> {
    return this.call<PublishedSite>('PATCH', `/sites/${encodeURIComponent(slug)}`, { visibility });
  }

  unpublish(slug: string): Promise<unknown> {
    return this.call('DELETE', `/sites/${encodeURIComponent(slug)}`);
  }

  site(slug: string): Promise<PublishedSite> {
    return this.call<PublishedSite>('GET', `/sites/${encodeURIComponent(slug)}`);
  }
}

/** A JWT's claims, unverified. */
function claims(token: string): Record<string, unknown> {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else if (e.isFile()) out.push(p);
  }
  return out;
}

/** A site name from a file name: lowercase letters, digits and dashes. */
export function slugFor(name: string): string {
  return name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\.pen$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'site';
}
