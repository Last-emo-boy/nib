import { useEffect, useState } from 'react';
import { authHeaders } from '../app/connection.ts';
import { desktop, type McpClientStatus } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { store, useEditor } from '../app/store.ts';
import { Icon } from './Icon.tsx';

/** Language, agent (MCP client) setup, and where nib keeps things. */
export function Settings() {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const [clients, setClients] = useState<McpClientStatus[] | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [version, setVersion] = useState('');
  useEffect(() => {
    void desktop?.mcpClients().then(setClients);
    fetch('/api/config', { headers: authHeaders() }).then((r) => r.json()).then((j) => setVersion(j.version)).catch(() => {});
  }, []);
  const setLang = (next: 'en' | 'zh') => { localStorage.setItem('nib-lang', next); store.set({ lang: next }); };
  return (
    <div className={`settings${desktop ? ' in-desktop' : ''}`}>
      <h1>{t.settings}</h1>
      <section>
        <h2>{t.languageTitle}</h2>
        <div className="segmented wide">
          <button className={lang === 'en' ? 'on' : ''} onClick={() => setLang('en')}>English</button>
          <button className={lang === 'zh' ? 'on' : ''} onClick={() => setLang('zh')}>中文</button>
        </div>
      </section>
      <section>
        <h2>{t.agentsTitle}</h2>
        <p className="dim">{t.agentsHint}</p>
        {!desktop && <pre className="code">claude mcp add nib -s user -- node &lt;nib&gt;/packages/mcp/src/main.ts</pre>}
        {desktop && !clients && <p className="dim">{t.loading}</p>}
        {clients?.map((c) => (
          <div key={c.id} className="client-row">
            <div className="client-name">
              <span>{c.name}</span>
              <span className="dim">{c.error ?? (!c.found ? t.notInstalled : c.elsewhere ? `${t.runsElsewhere} ${c.elsewhere}` : c.where)}</span>
            </div>
            {c.configured && !c.elsewhere
              ? <span className="client-ok"><Icon name="check" size={14} />{t.connected}</span>
              : <button className="dash-button" disabled={!c.found || busy === c.id} onClick={async () => {
                  setBusy(c.id);
                  const next = await desktop!.configureMcp(c.id);
                  setClients((list) => list?.map((x) => (x.id === c.id ? next : x)));
                  setBusy(undefined);
                }}>{busy === c.id ? t.loading : c.configured ? t.updateNib : t.addNib}</button>}
          </div>
        ))}
      </section>
      <section>
        <h2>{t.aboutTitle}</h2>
        <p className="dim">nib {version} · {t.aboutText}</p>
        <p className="dim">{t.credits}</p>
      </section>
    </div>
  );
}
