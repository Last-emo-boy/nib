import { useEffect, useState } from 'react';
import { authHeaders } from '../app/connection.ts';
import { desktop, type McpClientStatus } from '../app/desktop.ts';
import { useT } from '../app/i18n.ts';
import { setPrefs, store, useEditor } from '../app/store.ts';
import type { Prefs } from '../app/prefs.ts';
import { Icon } from './Icon.tsx';

/** Language, how the editor behaves and looks, agent (MCP client) setup, and where nib keeps things. */
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
      <EditorPrefs />
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

/** Nudge distances, zoom speed, the interface's look, motion and the pixel grid. */
function EditorPrefs() {
  const t = useT();
  const prefs = useEditor((s) => s.prefs);
  const pixelGrid = useEditor((s) => s.pixelGrid);
  const choice = <K extends 'theme' | 'motion'>(key: K, options: [Prefs[K], string][]) => (
    <div className="segmented">
      {options.map(([v, label]) => <button key={v} className={prefs[key] === v ? 'on' : ''} onClick={() => setPrefs({ [key]: v } as Partial<Prefs>)}>{label}</button>)}
    </div>
  );
  const number = (key: 'nudge' | 'bigNudge', label: string) => (
    <label className="pref-row">
      <span>{label}</span>
      <span className="pref-num"><input type="number" min={0.01} max={1000} step={key === 'nudge' ? 0.5 : 1} value={prefs[key]}
        onChange={(e) => { const v = Number(e.target.value); if (v > 0 && v <= 1000) setPrefs({ [key]: v }); }} /> px</span>
    </label>
  );
  return (
    <section>
      <h2>{t.editorPrefs}</h2>
      <div className="pref-row"><span>{t.interfaceTheme}</span>{choice('theme', [['dark', t.themeDark], ['light', t.themeLight], ['system', t.followSystem]])}</div>
      <div className="pref-row"><span>{t.motionPref}</span>{choice('motion', [['full', t.motionFull], ['reduced', t.motionReduced], ['system', t.followSystem]])}</div>
      {number('nudge', t.nudgeStep)}
      {number('bigNudge', t.bigNudgeStep)}
      <label className="pref-row">
        <span>{t.zoomSpeed}</span>
        <span className="pref-num"><input type="range" min={0.25} max={3} step={0.05} value={prefs.zoomSpeed} onChange={(e) => setPrefs({ zoomSpeed: Number(e.target.value) })} /> {prefs.zoomSpeed.toFixed(2)}×</span>
      </label>
      <label className="pref-row">
        <span>{t.togglePixelGrid}</span>
        <input type="checkbox" checked={pixelGrid} onChange={(e) => { localStorage.setItem('nib-pixel-grid', e.target.checked ? '1' : '0'); store.set({ pixelGrid: e.target.checked }); }} />
      </label>
    </section>
  );
}
