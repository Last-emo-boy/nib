import type OpenAI from 'openai';
import type { Keys } from './keys.ts';
import { textOf } from './util.ts';
import type { ModelChoice, Provider, ProviderInfo, RunRequest } from './types.ts';

type Message = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** A service that speaks the OpenAI chat completions API, with nib running the agent loop. */
export interface CompatiblePreset {
  id: string;
  name: string;
  baseURL: string;
  /** Environment variable that can hold the key; no key at all for local servers. */
  keyEnv?: string;
  needsKey: boolean;
}

export const PRESETS: CompatiblePreset[] = [
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com', keyEnv: 'DEEPSEEK_API_KEY', needsKey: true },
  { id: 'ollama', name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1', needsKey: false },
];

/** At most this many model calls per message, so a confused model cannot loop forever. */
const MAX_STEPS = 60;

interface ListedModel { id: string; name?: string; input_modalities?: string[] }

export class CompatibleProvider implements Provider {
  readonly id: string;
  private preset: CompatiblePreset;
  private keys: Keys;
  private models: { at: number; list: (ModelChoice & { vision: boolean })[] } | undefined;

  constructor(preset: CompatiblePreset, keys: Keys) {
    this.id = preset.id;
    this.preset = preset;
    this.keys = keys;
  }

  private key(): Promise<string | undefined> {
    return this.preset.needsKey ? this.keys.get(this.id, this.preset.keyEnv) : Promise.resolve('none');
  }

  /** The service's models (from its /models list, kept for five minutes). */
  private async list(key: string): Promise<(ModelChoice & { vision: boolean })[]> {
    if (this.models && Date.now() - this.models.at < 5 * 60_000) return this.models.list;
    const r = await fetch(`${this.preset.baseURL.replace(/\/$/, '')}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`${this.preset.name} answered ${r.status}`);
    const data = ((await r.json()) as { data?: ListedModel[] }).data ?? [];
    const list = data.map((m) => ({ id: m.id, label: m.name ?? m.id, vision: m.input_modalities?.includes('image') ?? false }));
    this.models = { at: Date.now(), list };
    return list;
  }

  async info(): Promise<ProviderInfo> {
    const key = await this.key();
    const base = { id: this.id, name: this.preset.name, auth: this.preset.needsKey ? 'key' as const : 'none' as const, models: [] as ModelChoice[], vision: false };
    if (!key) return { ...base, available: false, note: `Add a ${this.preset.name} API key.` };
    try {
      const models = await this.list(key);
      return { ...base, available: models.length > 0, models, vision: models.some((m) => m.vision), note: models.length ? undefined : 'No models found.' };
    } catch (e) {
      return { ...base, available: false, note: this.preset.needsKey ? `Could not reach ${this.preset.name}: ${(e as Error).message}` : `${this.preset.name} is not running on this computer.` };
    }
  }

  async run(req: RunRequest): Promise<void> {
    const key = await this.key();
    if (!key) throw new Error(`No ${this.preset.name} API key.`);
    const models = await this.list(key);
    const model = req.session.model || models[0]?.id;
    if (!model) throw new Error(`${this.preset.name} has no models.`);
    const vision = models.find((m) => m.id === model)?.vision ?? false;
    const [{ default: OpenAIClient }, { Client }, { StdioClientTransport }] = await Promise.all([
      import('openai'), import('@modelcontextprotocol/sdk/client/index.js'), import('@modelcontextprotocol/sdk/client/stdio.js'),
    ]);
    const api = new OpenAIClient({ apiKey: key, baseURL: this.preset.baseURL });
    const mcp = new Client({ name: 'nib-agent', version: '1.0.0' });
    await mcp.connect(new StdioClientTransport({ command: req.mcp.command, args: req.mcp.args, env: { ...inherited(), ...req.mcp.env } }));
    try {
      const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = (await mcp.listTools()).tools.map((t) => ({
        type: 'function', function: { name: t.name, description: t.description ?? '', parameters: t.inputSchema as Record<string, unknown> },
      }));
      const transcript = (req.session.transcript ?? []) as Message[];
      trimEarlierTurns(transcript);
      transcript.push({ role: 'user', content: req.prompt });
      req.session.transcript = transcript;
      let input = 0, output = 0, cached = 0;
      for (let step = 0; step < MAX_STEPS; step++) {
        const stream = await api.chat.completions.create(
          { model, messages: [{ role: 'system', content: req.system }, ...transcript], tools, stream: true, stream_options: { include_usage: true } },
          { signal: req.signal },
        );
        let text = '', reasoning = '';
        const calls: { id: string; name: string; args: string }[] = [];
        for await (const chunk of stream) {
          if (chunk.usage) {
            input += chunk.usage.prompt_tokens;
            output += chunk.usage.completion_tokens;
            // DeepSeek reports prompt_cache_hit_tokens; OpenAI-style services prompt_tokens_details.cached_tokens.
            const u = chunk.usage as typeof chunk.usage & { prompt_cache_hit_tokens?: number };
            cached += u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
          }
          const delta = chunk.choices[0]?.delta as (OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & { reasoning_content?: string }) | undefined;
          if (!delta) continue;
          if (delta.reasoning_content) reasoning += delta.reasoning_content;
          if (delta.content) { text += delta.content; req.emit({ t: 'text', delta: delta.content }); }
          for (const c of delta.tool_calls ?? []) {
            const call = (calls[c.index] ??= { id: '', name: '', args: '' });
            if (c.id) call.id = c.id;
            if (c.function?.name) call.name += c.function.name;
            if (c.function?.arguments) call.args += c.function.arguments;
          }
        }
        if (text) req.emit({ t: 'text-end', text });
        req.emit({ t: 'spent', tokens: input + output });
        // Thinking models need their reasoning back while they are still calling tools.
        transcript.push({
          role: 'assistant', content: text || null,
          ...(calls.length ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.args || '{}' } })) } : {}),
          ...(reasoning && calls.length ? { reasoning_content: reasoning } : {}),
        } as Message);
        if (!calls.length) break;
        const seen: { type: 'image_url'; image_url: { url: string } }[] = [];
        for (const call of calls) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.args || '{}') as Record<string, unknown>;
          } catch {
            transcript.push({ role: 'tool', tool_call_id: call.id, content: 'The arguments were not valid JSON. Send the call again with a JSON object.' });
            continue;
          }
          req.emit({ t: 'tool', id: call.id, name: call.name, input: args });
          const r = await mcp.callTool({ name: call.name, arguments: args }, undefined, { signal: req.signal, timeout: 10 * 60_000 });
          const content = (r.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string }[];
          const images = content.filter((c) => c.type === 'image' && c.data);
          if (vision) for (const i of images) seen.push({ type: 'image_url', image_url: { url: `data:${i.mimeType ?? 'image/png'};base64,${i.data}` } });
          const note = images.length && !vision ? `\n[${images.length} screenshot${images.length > 1 ? 's' : ''} not shown: this model cannot see images. Check the result with Get instead.]` : '';
          const body = content.filter((c) => c.type === 'text').map((c) => c.text).join('\n') + note;
          transcript.push({ role: 'tool', tool_call_id: call.id, content: body || '(no output)' });
          req.emit({ t: 'tool-done', id: call.id, ok: !r.isError, output: textOf(content) });
        }
        // Tool messages carry only text: screenshots follow as the person's message.
        if (seen.length) transcript.push({ role: 'user', content: [{ type: 'text', text: 'Screenshots from the tool calls above:' }, ...seen] });
      }
      req.emit({ t: 'usage', inputTokens: input, cachedTokens: cached, outputTokens: output });
    } finally {
      // Screenshots are for the run that took them; the saved conversation keeps a note instead.
      const transcript = (req.session.transcript ?? []) as Message[];
      for (const [i, m] of transcript.entries()) {
        if (m.role === 'user' && Array.isArray(m.content) && m.content.some((c) => c.type === 'image_url')) transcript[i] = { role: 'user', content: '(Screenshots from the tool calls above, no longer shown.)' };
      }
      await mcp.close().catch(() => {});
    }
  }
}

/**
 * Long tool results from earlier messages are rarely needed again but are sent with every request: keep
 * their start. (Done between messages, not during a run, so the provider's prompt cache holds within it.)
 */
function trimEarlierTurns(transcript: Message[]): void {
  for (const [i, m] of transcript.entries()) {
    if (m.role === 'tool' && typeof m.content === 'string' && m.content.length > TRIM_AT) {
      transcript[i] = { ...m, content: `${m.content.slice(0, TRIM_TO)}\n[… ${m.content.length - TRIM_TO} more characters from an earlier step]` };
    }
  }
}
const TRIM_AT = 2400, TRIM_TO = 1200;

/** The environment a child process needs to find its interpreter and files. */
function inherited(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) out[k] = v;
  return out;
}
