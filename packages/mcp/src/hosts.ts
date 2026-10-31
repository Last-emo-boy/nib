import { ensureDaemon, type BrowserArgs, type BrowserResult, type BrowserService, type DaemonInfo, type DocumentHost } from '@nib/daemon';
import type { ExecuteRequest } from '@nib/exec';

export interface ExecuteReply {
  ok: boolean;
  text: string;
  notes: string[];
  /** Base64 data. */
  images: { data: string; mimeType: string }[];
}

/** Where nib-mcp's documents live: the shared daemon, or this process when running headless. */
export interface McpHost {
  /** The MCP client's name, shown to editors as the author of its changes. */
  agent?: string;
  appState(filePath?: string): Promise<string>;
  execute(filePath: string, req: ExecuteRequest): Promise<ExecuteReply>;
  browser(filePath: string, args: BrowserArgs): Promise<BrowserResult>;
  /** Helpers for nib's own agent (session `parent`): start them, and wait for them. */
  spawnAgents?(parent: string, tasks: unknown): Promise<{ agents?: { id: string; title: string }[]; error?: string }>;
  waitAgents?(parent: string, ids: unknown, seconds: unknown): Promise<{ agents?: HelperState[]; error?: string }>;
}

export interface HelperState { id: string; title: string; running: boolean; reply?: string; error?: string; changed?: string[] }

/** Documents held in this process. */
export class LocalHost implements McpHost {
  agent?: string;
  private host: DocumentHost;
  private browserService: BrowserService | undefined;

  constructor(host: DocumentHost, browser?: BrowserService) {
    this.host = host;
    this.browserService = browser;
  }

  browser(filePath: string, args: BrowserArgs): Promise<BrowserResult> {
    if (!this.browserService) return Promise.resolve({ text: 'No browser is available.', images: [], isError: true });
    return this.browserService.run(filePath, args, this.agent);
  }

  appState(filePath?: string): Promise<string> {
    return this.host.appState(filePath);
  }

  async execute(filePath: string, req: ExecuteRequest): Promise<ExecuteReply> {
    const r = await this.host.execute(filePath, req, this.agent);
    return { ok: r.ok, text: r.text, notes: r.notes, images: r.images.map((i) => ({ data: Buffer.from(i.data).toString('base64'), mimeType: i.mimeType })) };
  }
}

/** Documents held by the daemon, shared with open editors so they see agent changes live. */
export class DaemonHost implements McpHost {
  agent?: string;
  private info: DaemonInfo;

  constructor(info: DaemonInfo) {
    this.info = info;
  }

  static async connect(): Promise<DaemonHost> {
    return new DaemonHost(await ensureDaemon());
  }

  async appState(filePath?: string): Promise<string> {
    return ((await this.post('/api/state', { filePath })) as { text: string }).text;
  }

  async execute(filePath: string, req: ExecuteRequest): Promise<ExecuteReply> {
    return (await this.post('/api/execute', { filePath, ...req, agent: this.agent ?? 'agent' })) as ExecuteReply;
  }

  async browser(filePath: string, args: BrowserArgs): Promise<BrowserResult> {
    return (await this.post('/api/browser', { filePath, ...args, agent: this.agent ?? 'agent' })) as BrowserResult;
  }

  async spawnAgents(parent: string, tasks: unknown): Promise<{ agents?: { id: string; title: string }[]; error?: string }> {
    return (await this.post('/api/agent/spawn', { parent, tasks })) as { agents?: { id: string; title: string }[]; error?: string };
  }

  async waitAgents(parent: string, ids: unknown, seconds: unknown): Promise<{ agents?: HelperState[]; error?: string }> {
    return (await this.post('/api/agent/wait', { parent, ids, seconds })) as { agents?: HelperState[]; error?: string };
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    let r: Response;
    try {
      r = await this.request(path, body);
    } catch {
      // The daemon went away (idle shutdown, restart): start or find it again.
      this.info = await ensureDaemon();
      r = await this.request(path, body);
    }
    const json = (await r.json()) as { error?: string };
    if (!r.ok) throw new Error(json.error ?? `nib daemon answered ${r.status}`);
    return json;
  }

  private request(path: string, body: unknown): Promise<Response> {
    return fetch(`http://127.0.0.1:${this.info.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.info.token}` },
      body: JSON.stringify(body),
    });
  }
}
