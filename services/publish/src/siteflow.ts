import { createHash } from 'node:crypto';
import { request as httpRequest, type IncomingMessage } from 'node:http';

/**
 * Siteflow, the w33d static host: nib-publish uploads each version of a site as a prebuilt deployment under
 * an internal host that Siteflow's own gateway sync never publishes (it publishes only `sf-*`), and serves it
 * by asking Siteflow for that host.
 */

export interface SiteFile { path: string; contentBase64: string }

export interface Deployment { deploymentId: string; projectId: string; previewHost: string; fileCount: number; totalBytes: number }

export class Siteflow {
  private base: URL;
  private token: string;
  private userAgent: string;

  constructor(base: string, token: string, userAgent: string) {
    this.base = new URL(base);
    this.token = token;
    this.userAgent = userAgent;
  }

  private async json<T>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await fetch(new URL(path, this.base), {
      method,
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', 'user-agent': this.userAgent },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    let j: unknown;
    try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 300) }; }
    if (!r.ok) throw new Error(`Siteflow ${method} ${path}: ${r.status} ${(j as { error?: string; message?: string }).error ?? (j as { message?: string }).message ?? ''}`.trim());
    return j as T;
  }

  /** Upload files as a deployment of project `projectSlug`, reachable inside Siteflow at `<hostPrefix>.<domain>`. */
  async deploy(projectSlug: string, hostPrefix: string, files: SiteFile[]): Promise<Deployment> {
    const payload = files.map((f) => {
      const bytes = Buffer.from(f.contentBase64, 'base64');
      return { path: f.path, contentBase64: f.contentBase64, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    });
    // nib's pages link to each other as `page.html`: no clean URLs (they would redirect those links away).
    return this.json<Deployment>('POST', '/api/deployments/prebuilt', { projectSlug, requestedHostPrefix: hostPrefix, entrypoint: 'index.html', files: payload, routing: { cleanUrls: false } });
  }

  /** Archive a project in Siteflow (its files stay; nib-publish no longer serves them). */
  async archive(projectId: string): Promise<void> {
    await this.json('DELETE', `/api/projects/${encodeURIComponent(projectId)}`);
  }

  /** A file of a deployment, as Siteflow serves it for `host`. */
  get(host: string, path: string, headers: Record<string, string>): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({
        hostname: this.base.hostname, port: this.base.port || 80, method: 'GET', path,
        headers: { ...headers, host, 'user-agent': this.userAgent },
      }, resolve);
      req.on('error', reject);
      req.setTimeout(20_000, () => req.destroy(new Error('Siteflow did not answer in time')));
      req.end();
    });
  }
}
