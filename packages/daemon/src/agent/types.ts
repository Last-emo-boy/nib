/** What a chat with nib's agent shows, item by item. */
export type ChatItem =
  | { kind: 'user'; id: string; at: number; text: string; selection?: string[] }
  | { kind: 'assistant'; id: string; at: number; text: string; streaming?: boolean }
  | { kind: 'tool'; id: string; at: number; name: string; input?: string; status: 'running' | 'done' | 'error'; output?: string }
  | { kind: 'error'; id: string; at: number; text: string }
  | { kind: 'usage'; id: string; at: number; costUsd?: number; inputTokens?: number; outputTokens?: number; durationMs: number };

export interface AgentSession {
  id: string;
  title: string;
  /** The document the agent works on. */
  doc: string;
  provider: string;
  model: string;
  created: number;
  updated: number;
  items: ChatItem[];
  /** The provider's own session or thread id, to continue the conversation there. */
  resume?: string;
  /** The conversation as an OpenAI-compatible API sees it (providers that nib drives itself). */
  transcript?: unknown[];
}

export type SessionSummary = Pick<AgentSession, 'id' | 'title' | 'doc' | 'provider' | 'model' | 'created' | 'updated'> & { running: boolean };

/** How to start nib's MCP server, which gives an agent its tools. */
export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** What a provider reports while it runs. */
export type RunEvent =
  | { t: 'text'; delta: string }
  /** The assistant's message so far is complete, with this text. */
  | { t: 'text-end'; text: string }
  | { t: 'tool'; id: string; name: string; input?: unknown }
  | { t: 'tool-done'; id: string; ok: boolean; output?: string }
  | { t: 'resume'; id: string }
  /** Something went wrong that does not stop the run. */
  | { t: 'warning'; text: string }
  | { t: 'usage'; costUsd?: number; inputTokens?: number; outputTokens?: number };

export interface RunRequest {
  session: AgentSession;
  /** The person's message, with the context nib adds. */
  prompt: string;
  /** Instructions for the agent: who it is, which document, how to work. */
  system: string;
  /** Whether this is the session's first message (providers without a system prompt send instructions then). */
  first: boolean;
  mcp: McpLaunch;
  signal: AbortSignal;
  emit: (e: RunEvent) => void;
}

export interface ModelChoice { id: string; label: string }

export interface ProviderInfo {
  id: string;
  name: string;
  /** How it signs in: the person's own subscription through its app, or an API key nib keeps. */
  auth: 'app' | 'key' | 'none';
  available: boolean;
  /** Why it is not available, or how it signs in. */
  note?: string;
  models: ModelChoice[];
  /** Whether it can look at screenshots. */
  vision: boolean;
}

export interface Provider {
  id: string;
  info(): Promise<ProviderInfo>;
  run(req: RunRequest): Promise<void>;
}
