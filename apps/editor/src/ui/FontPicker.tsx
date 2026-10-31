import { useEffect, useMemo, useRef, useState } from 'react';
import { fontList, GOOGLE_FONTS, pickFontFiles, type FontList } from '../app/fonts.ts';
import { useT } from '../app/i18n.ts';
import { Icon } from './Icon.tsx';

const MAX_SHOWN = 200;

/**
 * The font family field: shows the family, opens a searchable list of the design's own fonts, Google Fonts and
 * installed fonts. Any name typed can be used as is.
 */
export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<FontList>({ project: [], installed: [] });
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
    void fontList().then(setList);
    setTimeout(() => input.current?.focus(), 0);
    const away = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (f: string) => !q || f.toLowerCase().includes(q);
    const project = list.project.map((p) => p.family).filter(match);
    const taken = new Set(project.map((f) => f.toLowerCase()));
    const google = GOOGLE_FONTS.filter((f) => match(f) && !taken.has(f.toLowerCase()));
    for (const f of google) taken.add(f.toLowerCase());
    const installed = list.installed.filter((f) => match(f) && !taken.has(f.toLowerCase())).slice(0, MAX_SHOWN);
    return [
      { title: t.fontInDesign, items: project },
      { title: 'Google Fonts', items: google },
      { title: t.fontInstalled, items: installed },
    ].filter((g) => g.items.length);
  }, [list, query, t]);
  const flat = groups.flatMap((g) => g.items);
  const typed = query.trim();
  const choose = (family: string) => { setOpen(false); if (family && family !== value) onChange(family); };

  return (
    <div className="font-picker" ref={root}>
      <button className="num wide font-current" onClick={() => setOpen(!open)}>
        <span className="num-label">Aa</span>
        <span className="font-name" style={{ fontFamily: `"${value}", var(--ui-font, system-ui)` }}>{value}</span>
        <Icon name="chevronDown" size={12} />
      </button>
      {open && (
        <div className="font-menu">
          <input ref={input} className="font-search" placeholder={t.fontSearch} value={query}
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setOpen(false);
              else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(flat.length - 1, a + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
              else if (e.key === 'Enter') choose(flat[active] ?? typed);
            }} />
          <div className="font-list">
            {groups.map((g) => (
              <div key={g.title}>
                <div className="font-group">{g.title}</div>
                {g.items.map((f) => {
                  const i = flat.indexOf(f);
                  return (
                    <button key={f} className={`font-item${i === active ? ' active' : ''}${f === value ? ' current' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => choose(f)}
                      style={{ fontFamily: `"${f}", var(--ui-font, system-ui)` }}>{f}</button>
                  );
                })}
              </div>
            ))}
            {typed && !flat.some((f) => f.toLowerCase() === typed.toLowerCase()) && (
              <button className={`font-item${flat.length === 0 ? ' active' : ''}`} onClick={() => choose(typed)}>{t.useFont.replace('{name}', typed)}</button>
            )}
          </div>
          <button className="link font-add" onClick={() => void pickFontFiles().then((added) => { if (added[0]) choose(added[0]); })}>
            <Icon name="plus" size={12} /> {t.addFontFile}
          </button>
        </div>
      )}
    </div>
  );
}
