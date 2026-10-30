import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AgentService, type AgentEvent } from '../src/agent/service.ts';
import type { Provider, RunRequest } from '../src/agent/types.ts';

/** A provider that plays a fixed run, or waits until it is stopped. */
function fake(): Provider & { requests: RunRequest[] } {
  const requests: RunRequest[] = [];
  return {
    id: 'fake', requests,
    info: async () => ({ id: 'fake', name: 'Fake', auth: 'none', available: true, models: [{ id: 'm', label: 'M' }], vision: false }),
    async run(req) {
      requests.push(req);
      if (req.prompt.startsWith('wait')) {
        await new Promise((resolve) => req.signal.addEventListener('abort', resolve));
        throw new Error('aborted');
      }
      req.emit({ t: 'resume', id: 'thread-1' });
      req.emit({ t: 'text', delta: 'Look' });
      req.emit({ t: 'text', delta: 'ing.' });
      req.emit({ t: 'text-end', text: 'Looking.' });
      req.emit({ t: 'tool', id: 'c1', name: 'execute', input: { input: 'Insert(...)' } });
      req.emit({ t: 'tool-done', id: 'c1', ok: true, output: 'OK' });
      req.emit({ t: 'text-end', text: 'Done.' });
      req.emit({ t: 'usage', inputTokens: 10, outputTokens: 5 });
    },
  };
}

const settle = async (agent: AgentService, id: string) => {
  for (let i = 0; i < 100 && (await agent.get(id))?.running; i++) await new Promise((r) => setTimeout(r, 10));
};

describe('agent', () => {
  it('runs a provider, streams its items to editors of the document, saves and continues the session', async () => {
    const home = await mkdtemp(join(tmpdir(), 'nib-agent-'));
    const provider = fake();
    const agent = new AgentService({ home, providers: [provider] });
    const events: AgentEvent[] = [];
    agent.subscribe('/tmp/a.pen', (e) => events.push(e));

    const s = await agent.send({ doc: '/tmp/a.pen', provider: 'fake', text: 'Make a card', selection: ['x'], context: 'Selected: x' });
    await settle(agent, s.id);
    const session = (await agent.get(s.id))!;
    expect(session.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant', 'usage']);
    expect(session.items[1]).toMatchObject({ text: 'Looking.', streaming: false });
    expect(session.items[2]).toMatchObject({ name: 'execute', status: 'done', output: 'OK' });
    expect(session.items[4]).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(provider.requests[0]).toMatchObject({ first: true, prompt: 'Make a card\n\n<context>\nSelected: x\n</context>' });
    expect(provider.requests[0].mcp.env).toMatchObject({ NIB_HOME: home, NIB_AGENT: 'Fake' });
    // Editors saw the text grow, then the finished item.
    expect(events.filter((e) => e.item?.kind === 'assistant').map((e) => (e.item as { text: string }).text)).toEqual(['Look', 'Looking.', 'Looking.', 'Done.']);

    // The next message continues the provider's conversation.
    await agent.send({ session: s.id, doc: '/tmp/a.pen', provider: 'fake', text: 'Again' });
    await settle(agent, s.id);
    expect(provider.requests[1]).toMatchObject({ first: false });
    expect(provider.requests[1].session.resume).toBe('thread-1');
    await new Promise((r) => setTimeout(r, 50));
    const saved = JSON.parse(await readFile(join(home, 'agent', 'sessions', `${s.id}.json`), 'utf8'));
    expect(saved.items.filter((i: { kind: string }) => i.kind === 'user')).toHaveLength(2);
    expect(await new AgentService({ home, providers: [provider] }).list('/tmp/a.pen')).toMatchObject([{ id: s.id, title: 'Make a card' }]);
  });

  it('stops a run, and refuses a message while one is running', async () => {
    const agent = new AgentService({ home: await mkdtemp(join(tmpdir(), 'nib-agent-')), providers: [fake()] });
    const s = await agent.send({ doc: '/tmp/b.pen', provider: 'fake', text: 'wait for me' });
    await expect(agent.send({ session: s.id, doc: '/tmp/b.pen', provider: 'fake', text: 'more' })).rejects.toThrow(/still working/);
    agent.stop(s.id);
    await settle(agent, s.id);
    const items = (await agent.get(s.id))!.items;
    // A stopped run is not an error.
    expect(items.map((i) => i.kind)).toEqual(['user', 'usage']);
  });
});
