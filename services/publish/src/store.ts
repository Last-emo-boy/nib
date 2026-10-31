import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** A published site: who owns it, how it is seen, and the Siteflow deployment that holds its files. */
export interface Site {
  slug: string;
  name: string;
  owner: string;
  /** Shown to the owner only (the email nib signed in with); never used to decide access. */
  ownerLabel?: string;
  visibility: 'public' | 'private';
  /** Siteflow project, and the internal host of the current deployment (`nib-<id>-<version>.<domain>`). */
  siteId: string;
  projectId: string;
  host: string;
  version: number;
  deploymentId: string;
  files: number;
  bytes: number;
  created: string;
  updated: string;
}

/** The sites, in a JSON file, written whole and atomically; changes run one at a time. */
export class Sites {
  private file: string;
  private sites: Record<string, Site> | undefined;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(file: string) {
    this.file = file;
  }

  private async load(): Promise<Record<string, Site>> {
    if (!this.sites) {
      try {
        this.sites = (JSON.parse(await readFile(this.file, 'utf8')) as { sites: Record<string, Site> }).sites ?? {};
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        this.sites = {};
      }
    }
    return this.sites;
  }

  async get(slug: string): Promise<Site | undefined> {
    return (await this.load())[slug];
  }

  async ofOwner(owner: string): Promise<Site[]> {
    return Object.values(await this.load()).filter((s) => s.owner === owner).sort((a, b) => b.updated.localeCompare(a.updated));
  }

  /** Change the sites with `fn` (which sees them as they are now) and save them. */
  change<T>(fn: (sites: Record<string, Site>) => Promise<T> | T): Promise<T> {
    const run = this.queue.then(async () => {
      const sites = await this.load();
      const out = await fn(sites);
      await mkdir(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify({ sites }, null, 2));
      await rename(tmp, this.file);
      return out;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}
