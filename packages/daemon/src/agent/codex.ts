import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import type { ThreadItem } from '@openai/codex-sdk';
import { findExecutable, textOf } from './util.ts';
import type { Provider, ProviderInfo, RunRequest } from './types.ts';

/** Codex's own binary from the SDK's dependency, when it is installed. */
function bundledBinary(): boolean {
  try {
    const sdk = createRequire(import.meta.url).resolve('@openai/codex-sdk');
    const codex = createRequire(sdk).resolve('@openai/codex/package.json');
    createRequire(codex).resolve(`@openai/codex-${process.platform}-${process.arch}/package.json`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Codex through the Codex SDK: the person's ChatGPT subscription (their Codex sign-in), or an OpenAI API
 * key. It runs read-only in the document's folder; nib's MCP tools are how it changes the design.
 */
export class CodexProvider implements Provider {
  readonly id = 'codex';
  private executable: Promise<string | undefined> | undefined;

  /** '' for the SDK's own binary, else the Codex the person installed. */
  private binary(): Promise<string | undefined> {
    return (this.executable ??= bundledBinary() ? Promise.resolve('') : findExecutable('codex'));
  }

  async info(): Promise<ProviderInfo> {
    const bin = await this.binary();
    return {
      id: this.id, name: 'Codex', auth: 'app', vision: true,
      available: bin !== undefined,
      note: bin === undefined ? 'Install Codex and sign in to use your ChatGPT subscription.' : 'Uses your Codex sign-in (or OPENAI_API_KEY).',
      models: [{ id: '', label: 'Default' }, { id: 'gpt-5.5', label: 'GPT-5.5' }],
    };
  }

  async run(req: RunRequest): Promise<void> {
    const bin = await this.binary();
    if (bin === undefined) throw new Error('Codex is not installed.');
    const { Codex } = await import('@openai/codex-sdk');
    const codex = new Codex({
      ...(bin ? { codexPathOverride: bin } : {}),
      // nib's tools only change the open design, so they run without asking.
      config: { mcp_servers: { nib: { command: req.mcp.command, args: req.mcp.args, env: req.mcp.env, default_tools_approval_mode: 'approve' } } },
    });
    const options = {
      model: req.session.model || undefined, sandboxMode: 'read-only' as const, approvalPolicy: 'never' as const,
      workingDirectory: dirname(req.session.doc), skipGitRepoCheck: true,
    };
    const thread = req.session.resume ? codex.resumeThread(req.session.resume, options) : codex.startThread(options);
    // Codex has no separate system prompt: the instructions open the conversation.
    const input = req.first ? `${req.system}\n\n---\n\n${req.prompt}` : req.prompt;
    const { events } = await thread.runStreamed(input, { signal: req.signal });
    const said = new Map<string, number>();
    const message = (item: ThreadItem, done: boolean) => {
      if (item.type !== 'agent_message') return;
      const before = said.get(item.id) ?? 0;
      if (item.text.length > before) req.emit({ t: 'text', delta: item.text.slice(before) });
      said.set(item.id, item.text.length);
      if (done) req.emit({ t: 'text-end', text: item.text });
    };
    for await (const e of events) {
      switch (e.type) {
        case 'thread.started':
          req.emit({ t: 'resume', id: e.thread_id });
          break;
        case 'item.started':
          if (e.item.type === 'mcp_tool_call') req.emit({ t: 'tool', id: e.item.id, name: e.item.tool, input: e.item.arguments });
          message(e.item, false);
          break;
        case 'item.updated':
          message(e.item, false);
          break;
        case 'item.completed':
          if (e.item.type === 'mcp_tool_call') {
            const ok = e.item.status === 'completed' && !e.item.error;
            req.emit({ t: 'tool-done', id: e.item.id, ok, output: e.item.error?.message ?? textOf(e.item.result?.content) });
          }
          // Error items are Codex's own notices (about the person's Codex settings, unstable features); a
          // failure that matters ends the turn or fails a tool call.
          message(e.item, true);
          break;
        case 'turn.completed':
          req.emit({ t: 'usage', inputTokens: e.usage.input_tokens, outputTokens: e.usage.output_tokens });
          break;
        case 'turn.failed':
          throw new Error(e.error.message);
        case 'error':
          throw new Error(e.message);
      }
    }
  }
}
