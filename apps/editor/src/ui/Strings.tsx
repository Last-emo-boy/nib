import { useState } from 'react';
import { languagesOf, LANGUAGE_AXIS, stringsFromCsv, stringsTable, stringsToCsv, stringVariable } from '@nib/core';
import { commit } from '../app/actions.ts';
import { loadAgent, openSession, sendMessage } from '../app/agent.ts';
import { useT } from '../app/i18n.ts';
import { post } from '../app/libraries.ts';
import { store, toast, useEditor } from '../app/store.ts';

/**
 * The strings table: every translatable text of the document (string variables with a value per language,
 * on the Language theme axis), a column per language. Texts in a design become strings with "Make
 * translatable"; the agent fills in missing translations; CSV goes out to translators and comes back.
 */
export function Strings() {
  const t = useT();
  const doc = useEditor((s) => s.doc);
  const conn = useEditor((s) => s.conn);
  const selection = useEditor((s) => s.selection);
  const preview = useEditor((s) => s.previewLanguage);
  useEditor((s) => s.version);
  const [adding, setAdding] = useState(false);
  if (!doc || !conn) return null;
  const langs = languagesOf(doc.data);
  const rows = stringsTable(doc.data);
  const missing = rows.flatMap((r) => langs.filter((l) => !r.values[l]).map((l) => `${r.key} (${l})`));
  const setValue = (key: string, lang: string, value: string) => {
    const prev = doc.data.variables?.[key];
    void commit(`Translate ${key}`, (ed) => ed.setVariables({ ...(doc.data.variables ?? {}), [key]: stringVariable(prev, { [lang]: value }) }, langs.includes(lang) ? undefined : { ...(doc.data.themes ?? {}), [LANGUAGE_AXIS]: [...langs, lang] }));
  };
  const addLanguage = (code: string) => {
    const lang = code.trim();
    if (!/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(lang) || langs.includes(lang)) { toast(t.languageCodeHint); return; }
    void commit(`Add language ${lang}`, (ed) => ed.setDocument({ themes: { ...(doc.data.themes ?? {}), [LANGUAGE_AXIS]: [...(langs.length ? langs : ['en']), ...(langs.length || lang !== 'en' ? [lang] : [])] } }));
  };
  const extract = async () => {
    const ids = selection.length ? selection : doc.data.children.map((n) => n.id);
    try {
      const r = await post<{ made: number }>('/api/strings/extract', { doc: conn.path, ids, ...(langs[0] ? { language: langs[0] } : {}) });
      toast(t.stringsMade(r.made));
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const translate = async () => {
    store.set({ agentOpen: true, activityOpen: false, browserOpen: false });
    try {
      await loadAgent(conn.path);
      await openSession(undefined);
      await sendMessage(conn.path, t.translatePrompt(langs, missing.slice(0, 200)), []);
    } catch (e) {
      toast((e as Error).message);
    }
  };
  const exportCsv = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([stringsToCsv(doc.data)], { type: 'text/csv' }));
    a.download = `${conn.path.split('/').pop()?.replace(/\.pen$/, '') ?? 'strings'}-strings.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importCsv = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try {
        const vars = stringsFromCsv(doc.data, await f.text());
        const used = new Set(Object.values(vars).flatMap((v) => (Array.isArray(v.value) ? v.value.flatMap((e) => (e.theme?.[LANGUAGE_AXIS] ? [e.theme[LANGUAGE_AXIS]] : [])) : [])));
        const axis = [...langs, ...[...used].filter((l) => !langs.includes(l))];
        await commit('Import strings', (ed) => ed.setVariables({ ...(doc.data.variables ?? {}), ...vars }, { ...(doc.data.themes ?? {}), [LANGUAGE_AXIS]: axis }));
        toast(t.stringsImported(Object.keys(vars).length));
      } catch (e) {
        toast((e as Error).message);
      }
    };
    input.click();
  };
  return (
    <div className="strings">
      <div className="review-head">
        <span className="review-title">{t.strings}</span>
        <div className="review-actions">
          <button className="link" title={t.makeTranslatableHint} onClick={() => void extract()}>{t.makeTranslatable}</button>
        </div>
      </div>
      <div className="strings-langs">
        {langs.map((l, i) => <button key={l} className={`chip${preview === l ? ' on' : ''}`} title={t.previewLanguage} onClick={() => store.set({ previewLanguage: preview === l ? undefined : l })}>{l}{i === 0 ? ' ·' : ''}</button>)}
        {adding
          ? <input className="strings-new-lang" autoFocus placeholder="zh" onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { addLanguage(e.currentTarget.value); setAdding(false); } if (e.key === 'Escape') setAdding(false); }} onBlur={() => setAdding(false)} />
          : <button className="link" onClick={() => setAdding(true)}>+ {t.addLanguage}</button>}
      </div>
      {!rows.length && <p className="empty small">{t.noStrings}</p>}
      {rows.length > 0 && (
        <table className="variables strings-table">
          <thead><tr><th />{langs.map((l) => <th key={l}>{l}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="var-name" title={r.key}>{r.key.replace(/^str\./, '')}</td>
                {langs.map((l) => (
                  <td key={l} className={r.values[l] ? '' : 'missing'}>
                    <input className="var-input" defaultValue={r.values[l] ?? ''} key={`${r.key}:${l}:${r.values[l] ?? ''}`} placeholder="—"
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); }}
                      onBlur={(e) => { if (e.target.value !== (r.values[l] ?? '')) setValue(r.key, l, e.target.value); }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="strings-actions">
        {missing.length > 0 && langs.length > 1 && <button className="link" onClick={() => void translate()}>{t.translateMissing(missing.length)}</button>}
        {rows.length > 0 && <button className="link" onClick={exportCsv}>{t.exportCsv}</button>}
        <button className="link" onClick={importCsv}>{t.importCsv}</button>
      </div>
    </div>
  );
}
