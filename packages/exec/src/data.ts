import type { Node } from '@nib/format';
import { PLACEHOLDER } from '@nib/core';

/**
 * Data for designs: rows read from CSV or JSON, or made up (fake names, prices, dates), poured into a
 * template layer whose strings hold `{{field}}` placeholders — text, image urls, colors, names.
 */

export type Row = Record<string, unknown>;

/** CSV as rows keyed by its header line (quoted fields, doubled quotes, commas or semicolons or tabs). */
export function parseCsv(text: string): Row[] {
  const lines: string[][] = [];
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const sep = [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  let row: string[] = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) lines.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) lines.push(row);
  const [head, ...rest] = lines;
  if (!head) return [];
  const keys = head.map((k) => k.trim());
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, r[i]?.trim() ?? ''])));
}

/** Rows from a file's text: CSV, or JSON (a list of objects, or an object holding one). */
export function parseRows(text: string, name: string): Row[] {
  if (/\.csv$|\.tsv$/i.test(name)) return parseCsv(text);
  const j = JSON.parse(text) as unknown;
  const list = Array.isArray(j) ? j : j && typeof j === 'object' ? Object.values(j).find(Array.isArray) : undefined;
  if (!Array.isArray(list)) throw new Error(`${name} holds no list of rows`);
  return list.map((x) => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Row) : { value: x }));
}

export { placeholders } from '@nib/core';

const lookup = (row: Row, path: string): unknown => path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Row)[k] : undefined), row);

/** A copy of `node` with every `{{field}}` replaced by the row's value (missing ones: empty). */
export function fill(node: Node, row: Row): Node {
  const swap = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(PLACEHOLDER, (_m, k: string) => { const x = lookup(row, k); return x === undefined || x === null ? '' : String(x); });
    if (Array.isArray(v)) return v.map(swap);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k === 'id' ? x : swap(x)]));
    return v;
  };
  return swap(structuredClone(node)) as Node;
}

// Fake data ---------------------------------------------------------------------------------------

/** A seeded generator (mulberry32), so the same request makes the same rows. */
function random(seed: number) {
  let s = seed >>> 0 || 1;
  const next = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { next, pick: <T>(list: T[]) => list[Math.floor(next() * list.length)], int: (a: number, b: number) => a + Math.floor(next() * (b - a + 1)) };
}

const EN = {
  first: ['Ava', 'Liam', 'Maya', 'Noah', 'Zoe', 'Ethan', 'Ines', 'Omar', 'Lena', 'Kai', 'Priya', 'Mateo', 'Hana', 'Felix', 'Nora', 'Ravi', 'Chloe', 'Jonas', 'Amara', 'Leo'],
  last: ['Chen', 'Patel', 'Garcia', 'Okafor', 'Novak', 'Kim', 'Rossi', 'Silva', 'Haddad', 'Fischer', 'Tanaka', 'Moreau', 'Kowalski', 'Nguyen', 'Larsen', 'Costa'],
  company: ['Northwind', 'Brightside', 'Lumen Labs', 'Harbor & Co', 'Fieldnote', 'Stellar Foods', 'Quietpath', 'Copperleaf', 'Atlas Freight', 'Bluebird Health'],
  job: ['Product Designer', 'Engineer', 'Marketing Lead', 'Data Analyst', 'Account Manager', 'Founder', 'Support Specialist', 'Operations Manager'],
  city: ['Lisbon', 'Toronto', 'Berlin', 'Seoul', 'Austin', 'Melbourne', 'Nairobi', 'Copenhagen', 'Osaka', 'Bogotá'],
  country: ['Portugal', 'Canada', 'Germany', 'South Korea', 'United States', 'Australia', 'Kenya', 'Denmark', 'Japan', 'Colombia'],
  street: ['Maple Street', 'Harbor Road', 'Elm Avenue', 'Station Lane', 'Park Row', 'Mill Street'],
  status: ['Active', 'Pending', 'Paused', 'Completed', 'Draft'],
  product: ['Wool Throw', 'Ceramic Mug', 'Desk Lamp', 'Linen Shirt', 'Trail Shoes', 'Notebook Set', 'Espresso Grinder', 'Travel Pack'],
  tag: ['New', 'Popular', 'Sale', 'Limited', 'Classic', 'Eco'],
  words: ['quiet', 'morning', 'planning', 'better', 'simple', 'team', 'weekly', 'notes', 'growth', 'design', 'habits', 'focus', 'review', 'launch', 'calm', 'ideas'],
  months: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  domains: ['example.com', 'mail.test', 'studio.dev'],
};
const ZH = {
  last: ['王', '李', '张', '刘', '陈', '杨', '赵', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '林'],
  first: ['子涵', '欣怡', '浩然', '雨桐', '宇轩', '思远', '佳怡', '一诺', '梓萱', '俊杰', '晓雯', '明哲', '可欣', '天佑', '若曦', '博文'],
  company: ['星河科技', '青禾文化', '远山设计', '晨光食品', '蓝鲸物流', '知行教育', '云杉健康', '木白家居'],
  job: ['产品设计师', '前端工程师', '市场经理', '数据分析师', '客户经理', '创始人', '运营专员', '项目经理'],
  city: ['北京', '上海', '深圳', '杭州', '成都', '南京', '武汉', '西安', '苏州', '厦门'],
  country: ['中国'],
  street: ['人民路', '中山路', '解放路', '建设路', '和平街', '文化路'],
  status: ['进行中', '待处理', '已暂停', '已完成', '草稿'],
  product: ['羊毛毯', '陶瓷杯', '台灯', '亚麻衬衫', '越野跑鞋', '笔记本套装', '咖啡研磨机', '旅行背包'],
  tag: ['新品', '热销', '特惠', '限量', '经典', '环保'],
  words: ['安静', '清晨', '计划', '更好', '简单', '团队', '每周', '笔记', '成长', '设计', '习惯', '专注', '回顾', '发布'],
};

/** What a field's name asks for, by the words in it. */
const KINDS: [RegExp, string][] = [
  [/^(e-?mail|mail)/i, 'email'], [/phone|tel|mobile/i, 'phone'], [/first.?name/i, 'firstName'], [/last.?name|surname/i, 'lastName'],
  [/^(full.?)?name$|^author|^user(name)?$|^person|^customer$|^owner$|^member$/i, 'name'], [/initials/i, 'initials'],
  [/company|org|brand|employer/i, 'company'], [/job|role|position|title$/i, 'job'], [/city|town/i, 'city'], [/country/i, 'country'],
  [/address|street/i, 'address'], [/status|state$/i, 'status'], [/product|item/i, 'product'], [/tag|label|badge|category/i, 'tag'],
  [/price|cost|total|amount|revenue|balance|salary/i, 'price'], [/percent|rate|change|growth/i, 'percent'], [/rating|stars|score/i, 'rating'],
  [/date|created|updated|due|day/i, 'date'], [/time|hour/i, 'time'], [/color|colour/i, 'color'], [/count|qty|quantity|number|^n$|views|likes|orders/i, 'number'],
  [/headline|heading|subject|post|article/i, 'headline'], [/desc|summary|text|body|bio|message|comment|note/i, 'sentence'], [/^id$|code|sku/i, 'code'],
];

export function fieldKind(field: string): string {
  const name = field.split('.').pop() ?? field;
  return KINDS.find(([re]) => re.test(name))?.[1] ?? 'word';
}

const COLORS = ['#2F6FEB', '#E8590C', '#2B8A3E', '#AE3EC9', '#F08C00', '#0C8599', '#E03131', '#5F3DC4'];

/** `count` rows of believable made-up values for `fields`, chosen by their names; the same `seed` gives the same rows. */
export function fakeRows(fields: string[], count: number, opts: { locale?: 'en' | 'zh'; seed?: number } = {}): Row[] {
  const zh = opts.locale === 'zh';
  const r = random(opts.seed ?? 1);
  const rows: Row[] = [];
  for (let i = 0; i < count; i++) {
    const first = zh ? r.pick(ZH.first) : r.pick(EN.first), last = zh ? r.pick(ZH.last) : r.pick(EN.last);
    const value = (kind: string): unknown => {
      switch (kind) {
        case 'name': return zh ? `${last}${first}` : `${first} ${last}`;
        case 'firstName': return first;
        case 'lastName': return last;
        case 'initials': return zh ? last : `${first[0]}${last[0]}`;
        case 'email': return `${zh ? `user${r.int(10, 999)}` : `${first}.${last}`.toLowerCase().normalize('NFD').replace(/[^\w.]/g, '')}@${r.pick(EN.domains)}`;
        case 'phone': return zh ? `1${r.int(30, 99)} ${r.int(1000, 9999)} ${r.int(1000, 9999)}` : `+1 (${r.int(200, 989)}) ${r.int(200, 989)}-${r.int(1000, 9999)}`;
        case 'company': return r.pick((zh ? ZH : EN).company);
        case 'job': return r.pick((zh ? ZH : EN).job);
        case 'city': return r.pick((zh ? ZH : EN).city);
        case 'country': return r.pick((zh ? ZH : EN).country);
        case 'address': return zh ? `${r.pick(ZH.city)}市${r.pick(ZH.street)}${r.int(1, 300)}号` : `${r.int(1, 999)} ${r.pick(EN.street)}`;
        case 'status': return r.pick((zh ? ZH : EN).status);
        case 'product': return r.pick((zh ? ZH : EN).product);
        case 'tag': return r.pick((zh ? ZH : EN).tag);
        case 'price': return zh ? `¥${r.int(9, 2999)}` : `$${(r.int(500, 49999) / 100).toFixed(2)}`;
        case 'percent': return `${r.next() < 0.75 ? '+' : '−'}${(r.next() * 30).toFixed(1)}%`;
        case 'rating': return (3 + r.next() * 2).toFixed(1);
        case 'date': { const m = r.int(0, 11), d = r.int(1, 28); return zh ? `2026年${m + 1}月${d}日` : `${EN.months[m]} ${d}, 2026`; }
        case 'time': return `${String(r.int(7, 21)).padStart(2, '0')}:${r.pick(['00', '15', '30', '45'])}`;
        case 'color': return r.pick(COLORS);
        case 'number': return r.int(3, 9800);
        case 'code': return `#${r.int(1000, 9999)}`;
        case 'headline': { const w = zh ? ZH.words : EN.words; const s = Array.from({ length: zh ? 3 : r.int(4, 7) }, () => r.pick(w)).join(zh ? '' : ' '); return zh ? s : s[0].toUpperCase() + s.slice(1); }
        case 'sentence': { const w = zh ? ZH.words : EN.words; const s = Array.from({ length: zh ? r.int(5, 9) : r.int(8, 14) }, () => r.pick(w)).join(zh ? '' : ' '); return zh ? `${s}。` : `${s[0].toUpperCase()}${s.slice(1)}.`; }
        default: return r.pick((zh ? ZH : EN).words);
      }
    };
    const row: Row = {};
    for (const f of fields) {
      const kind = fieldKind(f);
      const v = value(kind);
      // A dotted field builds nested values: {{address.city}}.
      const keys = f.split('.');
      let at = row;
      for (const k of keys.slice(0, -1)) at = (at[k] ??= {}) as Row;
      at[keys.at(-1)!] = v;
    }
    rows.push(row);
  }
  return rows;
}
