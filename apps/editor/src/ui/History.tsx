import { useEffect, useState } from 'react';
import type { DocDiff } from '@nib/core';
import { authHeaders } from '../app/connection.ts';
import { useT } from '../app/i18n.ts';
import { post } from '../app/libraries.ts';
import { store, toast, useEditor } from '../app/store.ts';
import { boundsOf, fitView } from '../canvas/Canvas.tsx';

type Commit = { hash: string; short: string; date: string; author: string; subject: string };
type Pictures = Record<string, { before?: string; after?: string; diff?: string; similarity?: number }>;

/**
 * The document's history in git: the commits that changed it, and for one of them what changed since then,
 * frame by frame, with the frame before, after, and the difference between them.
 */
export function History() {
  const t = useT();
  const conn = useEditor((s) => s.conn);
  const doc = useEditor((s) => s.doc);
  const [commits, setCommits] = useState<Commit[] | undefined>();
  const [chosen, setChosen] = useState<string | undefined>();
  const [result, setResult] = useState<{ diff: DocDiff; pictures: Pictures } | 'loading' | undefined>();
  const [view, setView] = useState<'after' | 'before' | 'diff'>('diff');
  useEffect(() => {
    if (!conn) return;
    fetch(`/api/git/commits?${new URLSearchParams({ doc: conn.path })}`, { headers: authHeaders() }).then((r) => r.json()).then((j) => setCommits(j.commits ?? []), () => setCommits([]));
  }, [conn]);
  const compare = async (ref: string) => {
    if (!conn) return;
    setChosen(ref);
    setResult('loading');
    try {
      setResult(await post<{ diff: DocDiff; pictures: Pictures }>('/api/git/diff', { doc: conn.path, ref }));
    } catch (e) {
      setResult(undefined);
      toast((e as Error).message);
    }
  };
  const show = (id: string) => { if (doc?.has(id)) { store.set({ selection: [id] }); const b = boundsOf([id]); if (b) store.set({ view: fitView(b, 1.5) }); } };
  if (!commits) return <p className="empty">{t.loading}</p>;
  if (!commits.length) return <p className="empty">{t.noHistory}</p>;
  const r = result && result !== 'loading' ? result : undefined;
  return (
    <div className="history">
      <div className="history-commits">
        {commits.map((c) => (
          <button key={c.hash} className={`history-commit${chosen === c.hash ? ' on' : ''}`} onClick={() => void compare(c.hash)} title={`${c.hash}\n${c.author}`}>
            <span className="history-subject">{c.subject}</span>
            <span className="history-meta">{c.short} · {new Date(c.date).toLocaleDateString()} · {c.author}</span>
          </button>
        ))}
      </div>
      {result === 'loading' && <p className="empty small">{t.comparing}</p>}
      {r && (
        <div className="history-diff">
          <div className="review-head">
            <span className="review-title">{t.sinceCommit(commits.find((c) => c.hash === chosen)?.short ?? '')}</span>
            <div className="segmented">
              {(['before', 'after', 'diff'] as const).map((v) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{t.historyViews[v]}</button>)}
            </div>
          </div>
          {!r.diff.frames.length && !r.diff.document.length && <p className="empty small">{t.noChangesSince}</p>}
          {r.diff.document.map((d) => <div key={d} className="impl-item">{d}</div>)}
          {r.diff.frames.map((f) => {
            const p = r.pictures[f.id];
            const src = p?.[view] ?? p?.after ?? p?.before;
            return (
              <div key={f.id} className="history-frame">
                <button className="history-frame-name" onClick={() => show(f.id)}>{f.name} · {t.frameKinds[f.kind]}{p?.similarity !== undefined ? ` · ${Math.round(p.similarity * 1000) / 10}%` : ''}</button>
                {src && <img className="impl-diff" src={`data:image/png;base64,${src}`} alt="" />}
                {f.layers.slice(0, 8).map((l) => <div key={l.id} className="impl-item">{l.kind === 'added' ? '+' : l.kind === 'removed' ? '−' : '~'} {l.name}{l.props?.length ? `: ${l.props.join(', ')}` : ''}</div>)}
                {f.layers.length > 8 && <div className="impl-item">…</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
