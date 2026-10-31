import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { findExecutable, signedIn, textOf } from './util.ts';
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
 * The environment Claude Code runs with: this process's, plus the `env` block of the person's Claude Code
 * settings (where a sign-in through a gateway lives: ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL). The run
 * itself loads no settings, so their CLAUDE.md, hooks and other MCP servers stay out of nib's agent.
 */
async function claudeEnv(): Promise<Record<string, string | undefined>> {
  const dir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  let fromSettings: Record<string, string> = {};
  try {
    const env = (JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8')) as { env?: Record<string, unknown> }).env ?? {};
    fromSettings = Object.fromEntries(Object.entries(env).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    // No settings: the sign-in is in the keychain or the environment.
  }
  // A daemon started from inside Claude Code must not look like a nested session to the one it starts.
  return { ...process.env, ...fromSettings, CLAUDECODE: undefined, CLAUDE_CODE_ENTRYPOINT: undefined };
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
    // The sign-in check needs a claude command; with only the SDK's own binary, trust it.
    const cli = bin || (await findExecutable('claude'));
    const ok = bin !== undefined && (!cli || (await signedIn(cli, ['auth', 'status'], await claudeEnv(), (out) => /"loggedIn":\s*true/.test(out))));
    return {
      id: this.id, name: 'Claude', auth: 'app', vision: true,
      available: ok,
      note: bin === undefined ? 'Install Claude Code and sign in to use your Claude subscription.' : ok ? 'Uses your Claude Code sign-in (or ANTHROPIC_API_KEY).' : 'Sign in to Claude Code to use your Claude subscription.',
      signIn: bin === undefined ? undefined : 'claude',
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
    const env = await claudeEnv();
    // With images, the message goes as content blocks: the images, then the text.
    const prompt = req.images?.length
      ? (async function* () {
          const images = await Promise.all(req.images!.map(async (i) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: i.mimeType as 'image/png', data: (await readFile(i.path)).toString('base64') } })));
          yield { type: 'user' as const, message: { role: 'user' as const, content: [...images, { type: 'text' as const, text: req.prompt }] }, parent_tool_use_id: null };
        })()
      : req.prompt;
    const q = query({
      prompt,
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
        ...(req.budgetUsd ? { maxBudgetUsd: req.budgetUsd } : {}),
      },
    });
    const seen = new Map<string, number>();
    for await (const m of q) {
      // Each model call's usage, once per message (streamed blocks of one message repeat it).
      if (m.type === 'assistant' && m.parent_tool_use_id === null && m.message.usage) {
        const u = m.message.usage;
        seen.set(m.message.id, u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + u.output_tokens);
        req.emit({ t: 'spent', tokens: [...seen.values()].reduce((a, b) => a + b, 0) });
      }
      this.handle(m, req);
    }
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
