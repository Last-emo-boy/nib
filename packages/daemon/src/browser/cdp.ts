/** A Chrome DevTools Protocol connection over a WebSocket, with flat sessions for pages. */
export class Cdp {
  private ws: WebSocket;
  private next = 0;
  private calls = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private handlers = new Map<string, Set<(params: any, sessionId?: string) => void>>();
  closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data));
      if (msg.id !== undefined) {
        const call = this.calls.get(msg.id);
        this.calls.delete(msg.id);
        if (msg.error) call?.reject(new Error(`${msg.error.message}${msg.error.data ? `: ${msg.error.data}` : ''}`));
        else call?.resolve(msg.result);
      } else if (msg.method) {
        for (const h of this.handlers.get(msg.method) ?? []) h(msg.params, msg.sessionId);
      }
    };
    ws.onclose = () => {
      this.closed = true;
      for (const c of this.calls.values()) c.reject(new Error('the browser connection closed'));
      this.calls.clear();
    };
  }

  static connect(url: string): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => resolve(new Cdp(ws));
      ws.onerror = () => reject(new Error(`cannot connect to the browser at ${url}`));
    });
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = 60_000): Promise<T> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.calls.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
      this.calls.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); }, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  on(event: string, handler: (params: any, sessionId?: string) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Resolves on the next `event` for `sessionId`, or after `timeoutMs` (then with undefined). */
  waitFor(event: string, sessionId: string | undefined, timeoutMs: number): Promise<any> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { off(); resolve(undefined); }, timeoutMs);
      const off = this.on(event, (params, sid) => {
        if (sessionId && sid !== sessionId) return;
        clearTimeout(timer);
        off();
        resolve(params);
      });
    });
  }

  close(): void {
    this.ws.close();
  }
}
