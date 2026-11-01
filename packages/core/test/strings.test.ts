import { describe, expect, it } from 'vitest';
import type { PenDocument } from '@nib/format';
import { buildScene, DocEditor, extractStrings, PenDoc, stringsFromCsv, stringsTable, stringsToCsv } from '../src/index.ts';

const page = () => new PenDoc({ version: '2.20', themes: { Language: ['en', 'zh'] }, variables: {
  'str.home.title': { type: 'string', value: [{ value: 'Welcome', theme: { Language: 'en' } }, { value: '欢迎', theme: { Language: 'zh' } }] },
}, children: [{ type: 'frame', id: 'home', name: 'Home', x: 0, y: 0, width: 300, height: 200, children: [
  { type: 'text', id: 'title', content: '$str.home.title' },
  { type: 'text', id: 'cta', name: 'Start button', content: 'Get started' },
  { type: 'text', id: 'cta2', content: 'Get started' },
  { type: 'text', id: 'price', content: '$48.2K' },
] }] } as unknown as PenDocument);

describe('strings', () => {
  it('lists translatable strings with a value per language', () => {
    expect(stringsTable(page().data)).toEqual([{ key: 'str.home.title', values: { en: 'Welcome', zh: '欢迎' } }]);
  });

  it('turns literal texts into strings, one per distinct text, and leaves variables alone', () => {
    const doc = page();
    const r = extractStrings(doc, ['home'], 'en');
    expect(Object.keys(r.variables)).toEqual(['str.home.start-button', 'str.home.48-2k']);
    expect(r.contents).toEqual([{ id: 'cta', content: '$str.home.start-button' }, { id: 'cta2', content: '$str.home.start-button' }, { id: 'price', content: '$str.home.48-2k' }]);
    expect(r.variables['str.home.start-button']).toEqual({ type: 'string', value: [{ value: 'Get started', theme: { Language: 'en' } }] });
  });

  it('shows each frame in the language of its theme, or the one the editor forces', () => {
    const doc = page();
    const ed = new DocEditor(doc);
    ed.begin(); ed.set('home', { theme: { Language: 'zh' } }); ed.commit();
    const text = (o = {}) => buildScene(doc, doc.get('home')!, o)!.children![0].content;
    expect(text()).toBe('欢迎');
    expect(text({ force: { Language: 'en' } })).toBe('Welcome');
  });

  it('goes out to CSV and comes back, keeping what a cell leaves empty', () => {
    const doc = page();
    const csv = stringsToCsv(doc.data);
    expect(csv).toBe('key,en,zh\nstr.home.title,Welcome,欢迎\n');
    const back = stringsFromCsv(doc.data, 'key,en,zh,ja\nstr.home.title,"Welcome, friend",,ようこそ\nstr.new,Hi,你好,\n');
    expect(back['str.home.title']).toEqual({ type: 'string', value: [{ value: '欢迎', theme: { Language: 'zh' } }, { value: 'Welcome, friend', theme: { Language: 'en' } }, { value: 'ようこそ', theme: { Language: 'ja' } }] });
    expect(back['str.new'].value).toEqual([{ value: 'Hi', theme: { Language: 'en' } }, { value: '你好', theme: { Language: 'zh' } }]);
    expect(() => stringsFromCsv(doc.data, 'name,en\nx,y')).toThrow('the first column is "key"');
  });
});
