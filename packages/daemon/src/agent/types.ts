/** A file the person attached to a message, kept with the session. */
export interface Attachment { name: string; type: string; file: string }

/** What a chat with nib's agent shows, item by item. */
export type ChatItem =
  /** `checkpoint`: the document as it was before this message is saved, so the design can go back to it. */
  | { kind: 'user'; id: string; at: number; text: string; selection?: string[]; checkpoint?: boolean; attachments?: Attachment[] }
  | { kind: 'assistant'; id: string; at: number; text: string; streaming?: boolean }
  | { kind: 'tool'; id: string; at: number; name: string; input?: string; status: 'running' | 'done' | 'error'; output?: string }
  | { kind: 'error'; id: string; at: number; text: string }
  /** `changed`: names of the top-level frames the run added, changed or removed. */
  | { kind: 'usage'; id: string; at: number; costUsd?: number; inputTokens?: number; cachedTokens?: number; outputTokens?: number; durationMs: number; changed?: string[] };

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
  /** One of several variants made at once, each on its own copy of a frame. */
  variant?: { group: string; of: string; frame: string; index: number; count: number };
  /** The session whose agent started this one as a helper (spawn_agents). */
  parent?: string;
}

export type SessionSummary = Pick<AgentSession, 'id' | 'title' | 'doc' | 'provider' | 'model' | 'created' | 'updated' | 'variant' | 'parent'> & { running: boolean };

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
  /** Tokens used so far in this run (input and output), for the budget. */
  | { t: 'spent'; tokens: number }
  /** Input tokens include the cached ones (read from the provider's prompt cache, billed far lower). */
  | { t: 'usage'; costUsd?: number; inputTokens?: number; cachedTokens?: number; outputTokens?: number };

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
  /** At most this many dollars for this message, where the provider can hold to it (Claude). */
  budgetUsd?: number;
  /** Images attached to this message, to show the model (files on disk). */
  images?: { path: string; mimeType: string }[];
}

/** A command: a message to the agent saved under a name, to send again (on another selection, another day). */
export interface Macro { name: string; text: string; created: number }

/** What the person set for the agent: budgets per message. */
export interface AgentSettings {
  tokensPerMessage?: number;
  usdPerMessage?: number;
}

/** Usage over a period (this month), across sessions. */
export interface UsageTotals { messages: number; inputTokens: number; cachedTokens: number; outputTokens: number; costUsd: number }

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
  /** The command that signs in, run in Terminal for the person (providers that use their app's sign-in). */
  signIn?: string;
}

export interface Provider {
  id: string;
  info(): Promise<ProviderInfo>;
  run(req: RunRequest): Promise<void>;
}
