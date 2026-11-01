/** Which release is newer, and which of its files is the app for this machine. */

export interface Release {
  version: string;
  /** The release's page, for downloading by hand. */
  url: string;
  /** The app as a zip nib can put in place itself (macOS). */
  asset?: { name: string; url: string; size: number };
}

const parts = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0].split('.').map((n) => Number.parseInt(n, 10) || 0);

/** Whether version `a` comes after `b` (1.10.0 after 1.9.2; pre-release suffixes ignored). */
export function newer(a: string, b: string): boolean {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  }
  return false;
}

/** A GitHub release (the API's JSON) as what nib needs of it; undefined when it is not one. */
export function readRelease(json: unknown, platform: string, arch: string): Release | undefined {
  const r = json as { tag_name?: unknown; html_url?: unknown; draft?: unknown; prerelease?: unknown; assets?: { name?: unknown; browser_download_url?: unknown; size?: unknown }[] };
  if (typeof r?.tag_name !== 'string' || typeof r.html_url !== 'string' || r.draft || r.prerelease) return undefined;
  const version = r.tag_name.replace(/^v/, '');
  const wanted = platform === 'darwin' ? `nib-${version}-mac-${arch}.zip` : undefined;
  const a = (r.assets ?? []).find((x) => x.name === wanted && typeof x.browser_download_url === 'string');
  return { version, url: r.html_url, ...(a ? { asset: { name: a.name as string, url: a.browser_download_url as string, size: Number(a.size) || 0 } } : {}) };
}
