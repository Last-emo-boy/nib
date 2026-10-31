import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serializePen, type PenDocument } from '@nib/format';
import { createNodeRenderer, PackageIconSource } from '@nib/render/node';
import { AgentService } from '../src/agent/service.ts';
import type { Provider, RunRequest } from '../src/agent/types.ts';
import { DocumentHost, startDaemon, type Daemon } from '../src/index.ts';

const none = { load: async () => undefined };
const requests: RunRequest[] = [];
// The lead keeps working until the test lets it finish; helpers finish at once.
let release: () => void = () => {};
const fake: Provider = {
  id: 'fake',
  info: async () => ({ id: 'fake', name: 'Fake', auth: 'none', available: true, models: [], vision: false }),
  async run(req) {
    requests.push(req);
    if (req.prompt.startsWith('Lead')) await new Promise<void>((res) => { release = res; });
    req.emit({ t: 'text-end', text: `Made it (${req.prompt.split('\n')[0]}).` });
  },
};

let daemon: Daemon, host: DocumentHost, agent: AgentService, dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'nib-helpers-'));
  const renderer = await createNodeRenderer();
  host = new DocumentHost({ renderer, images: () => none });
  agent = new AgentService({ home: dir, providers: [fake] });
  daemon = await startDaemon({ host, renderer, agent, fonts: none, icons: new PackageIconSource(), images: () => none, fallbacks: renderer.fallbacks, port: 0 });
});
afterAll(async () => { await daemon.close(); host.close(); });

const api = async (path: string, body?: unknown) => {
  const r = await fetch(`http://127.0.0.1:${daemon.port}${path}`, body === undefined ? { headers: { authorization: `Bearer ${daemon.token}` } } : { method: 'POST', headers: { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
};

describe('helpers', () => {
  it('lets a working agent start helpers on frames, wait for them, and stop them with it', async () => {
    const path = join(dir, 'h.pen');
    await writeFile(path, serializePen({ version: '2.20', children: [
      { type: 'frame', id: 'a', name: 'Home', x: 0, y: 0, width: 390, height: 844 },
      { type: 'frame', id: 'b', name: 'Settings', x: 500, y: 0, width: 390, height: 844 },
    ] } as unknown as PenDocument));
    const lead = (await api('/api/agent/send', { doc: path, provider: 'fake', text: 'Lead: make the app' })).json.session;
    for (let i = 0; i < 100 && !requests.length; i++) await new Promise((res) => setTimeout(res, 10));
    // Its MCP server knows which session it serves.
    expect(requests[0].mcp.env.NIB_SESSION).toBe(lead.id);
    expect((await api('/api/agent/spawn', { parent: 'nope', tasks: [{ task: 'x' }] })).json.error).toMatch(/working agent/);
    expect((await api('/api/agent/spawn', { parent: lead.id, tasks: [{ task: 'x', frameId: 'zzz' }] })).json.error).toMatch(/no layer with id zzz/);
    expect((await api('/api/agent/spawn', { parent: lead.id, tasks: Array(7).fill({ task: 'x' }) })).json.error).toMatch(/at most 6/);
    const r = await api('/api/agent/spawn', { parent: lead.id, tasks: [{ task: 'Build the home screen', frameId: 'a', title: 'Home' }, { task: 'Build the settings screen', frameId: 'b' }] });
    expect(r.status).toBe(200);
    const ids = r.json.agents.map((a: { id: string }) => a.id);
    expect(r.json.agents.map((a: { title: string }) => a.title)).toEqual(['Home', 'Build the settings screen']);
    const done = await api('/api/agent/wait', { parent: lead.id, ids, seconds: 5 });
    expect(done.json.agents.map((a: { running: boolean; reply: string }) => [a.running, a.reply])).toEqual([[false, 'Made it (Build the home screen).'], [false, 'Made it (Build the settings screen).']]);
    const home = requests.find((q) => q.prompt.startsWith('Build the home'))!;
    expect(home.prompt).toContain('another agent ("Lead: make the app")');
    expect(home.prompt).toContain('inside the frame with id a');
    expect(home.prompt).toContain('working at the same time as 1 other helper');
    // Helpers are listed with the agent that started them; they cannot start helpers, and others cannot wait on them.
    const sessions = (await api(`/api/agent/sessions?doc=${encodeURIComponent(path)}`)).json.sessions as { id: string; parent?: string }[];
    expect(sessions.filter((s) => s.parent === lead.id).map((s) => s.id).sort()).toEqual([...ids].sort());
    expect((await api('/api/agent/wait', { parent: 'other', ids, seconds: 0 })).json.error).toMatch(/helpers this agent started/);
    release();
    for (let i = 0; i < 100 && (await agent.get(lead.id))?.running; i++) await new Promise((res) => setTimeout(res, 10));
    expect((await api('/api/agent/spawn', { parent: lead.id, tasks: [{ task: 'x' }] })).json.error).toMatch(/working agent/);
  });
});

describe('commands', () => {
  it('saves messages as named commands, replaces one of the same name, and deletes them', async () => {
    expect((await api('/api/agent/macros')).json.macros).toEqual([]);
    expect((await api('/api/agent/macros', { name: ' ', text: 'x' })).json.error).toMatch(/needs a name/);
    await api('/api/agent/macros', { name: 'Tighten spacing', text: 'Make the gaps in the selection consistent.' });
    await api('/api/agent/macros', { name: 'Dark version', text: 'Make a dark copy.' });
    const list = (await api('/api/agent/macros', { name: 'tighten spacing', text: 'Use an 8px grid.' })).json.macros;
    expect(list.map((m: { name: string; text: string }) => [m.name, m.text])).toEqual([['Dark version', 'Make a dark copy.'], ['tighten spacing', 'Use an 8px grid.']]);
    expect((await api('/api/agent/macros/delete', { name: 'Dark version' })).json.macros.map((m: { name: string }) => m.name)).toEqual(['tighten spacing']);
  });
});
