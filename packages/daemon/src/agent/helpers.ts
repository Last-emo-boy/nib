/**
 * Helpers: agents an agent starts for parts of a request that do not depend on each other (spawn_agents),
 * working at the same time on the same document. A helper sees the document, not its starter's
 * conversation, so each task is written to stand on its own; helpers do not start helpers of their own.
 */

export const MAX_HELPERS = 6;

export interface HelperTask { task: string; frameId?: string; title?: string }

/** Tasks from a tool call, or why they cannot run. */
export function helperTasks(raw: unknown): HelperTask[] | string {
  if (!Array.isArray(raw) || !raw.length) return 'tasks must be a list of 1 to 6 tasks';
  if (raw.length > MAX_HELPERS) return `at most ${MAX_HELPERS} helpers at once`;
  const out: HelperTask[] = [];
  for (const t of raw) {
    const task = (t as { task?: unknown })?.task;
    if (typeof task !== 'string' || !task.trim()) return 'each task needs `task`: what the helper should do';
    const { frameId, title } = t as { frameId?: unknown; title?: unknown };
    out.push({ task: task.trim(), ...(typeof frameId === 'string' && frameId ? { frameId } : {}), ...(typeof title === 'string' && title.trim() ? { title: title.trim() } : {}) });
  }
  return out;
}

/** What a helper is told besides its task. */
export function helperPrompt(t: HelperTask, starter: string, count: number): string {
  return `<helper>
You are a helper that another agent ("${starter}") started for one part of a larger request${count > 1 ? `, working at the same time as ${count - 1} other helper${count > 2 ? 's' : ''} on the same document` : ''}. Do only this task${t.frameId ? `, inside the frame with id ${t.frameId}: change, add or remove what is in it and leave every other layer alone` : ', and leave layers other helpers may be working on alone'}. Only the agent that started you reads your reply: end with a short summary of what you made, with the ids of the frames, and anything left undone.
</helper>`;
}
