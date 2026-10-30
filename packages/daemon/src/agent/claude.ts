import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { findExecutable, textOf } from './util.ts';
import type { Provider, ProviderInfo, RunRequest } from './types.ts';

/** nib's tools as Claude Code names them. */
const TOOLS = ['get_app_state', 'execute', 'browser', 'read_skill', 'get_style'].map((t) => `mcp__nib__${t}`);

/** Claude Code's own binary from the SDK's platform package, when it is installed. */
function bundledBinary(): boolean {
  try {
    const sdk = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk');
    createRequire(sdk).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/package.json`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Claude through the Claude Agent SDK: the person's Claude subscription (their Claude Code sign-in), or
 * ANTHROPIC_API_KEY. The agent gets nib's MCP tools and nothing else: no shell, no file access.
 */
export class ClaudeProvider implements Provider {
  readonly id = 'claude';
  private executable: Promise<string | undefined> | undefined;

  /** The SDK's own binary, or else the Claude Code the person installed. */
  private binary(): Promise<string | undefined> {
    return (this.executable ??= bundledBinary() ? Promise.resolve('') : findExecutable('claude'));
  }

  async info(): Promise<ProviderInfo> {
    const bin = await this.binary();
    return {
      id: this.id, name: 'Claude', auth: 'app', vision: true,
      available: bin !== undefined,
      note: bin === undefined ? 'Install Claude Code and sign in to use your Claude subscription.' : 'Uses your Claude Code sign-in (or ANTHROPIC_API_KEY).',
      models: [{ id: '', label: 'Default' }, { id: 'opus', label: 'Opus' }, { id: 'sonnet', label: 'Sonnet' }, { id: 'haiku', label: 'Haiku' }],
    };
  }

  async run(req: RunRequest): Promise<void> {
    const bin = await this.binary();
    if (bin === undefined) throw new Error('Claude Code is not installed.');
    // The SDK is large: load it when an agent first runs, not when the daemon starts.
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const abort = new AbortController();
    req.signal.addEventListener('abort', () => abort.abort(), { once: true });
    // A daemon started from inside Claude Code must not look like a nested session to the one it starts.
    const env: Record<string, string | undefined> = { ...process.env, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined };
    const q = query({
      prompt: req.prompt,
      options: {
        model: req.session.model || undefined,
        systemPrompt: req.system,
        tools: [],
        mcpServers: { nib: { type: 'stdio', command: req.mcp.command, args: req.mcp.args, env: req.mcp.env, alwaysLoad: true } },
        allowedTools: TOOLS,
        permissionMode: 'dontAsk',
        settingSources: [],
        cwd: dirname(req.session.doc),
        resume: req.session.resume,
        includePartialMessages: true,
        abortController: abort,
        env,
        ...(bin ? { pathToClaudeCodeExecutable: bin } : {}),
      },
    });
    for await (const m of q) this.handle(m, req);
  }

  private handle(m: SDKMessage, req: RunRequest): void {
    const { emit } = req;
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init') emit({ t: 'resume', id: m.session_id });
        break;
      case 'stream_event':
        if (m.parent_tool_use_id === null && m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta') emit({ t: 'text', delta: m.event.delta.text });
        break;
      case 'assistant':
        if (m.parent_tool_use_id !== null) break;
        for (const b of m.message.content) {
          if (b.type === 'text') emit({ t: 'text-end', text: b.text });
          else if (b.type === 'tool_use') emit({ t: 'tool', id: b.id, name: b.name.replace(/^mcp__nib__/, ''), input: b.input });
        }
        break;
      case 'user': {
        const content = m.message.content;
        if (typeof content === 'string') break;
        for (const b of content) {
          if (b.type === 'tool_result') emit({ t: 'tool-done', id: b.tool_use_id, ok: !b.is_error, output: textOf(b.content) });
        }
        break;
      }
      case 'result':
        emit({ t: 'usage', costUsd: m.total_cost_usd, inputTokens: m.usage.input_tokens + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0), cachedTokens: m.usage.cache_read_input_tokens ?? 0, outputTokens: m.usage.output_tokens });
        if (m.subtype !== 'success') throw new Error(m.errors?.join('\n') || `Claude stopped: ${m.subtype}`);
        if (m.is_error) throw new Error(m.result || 'Claude could not finish.');
        break;
    }
  }
}
