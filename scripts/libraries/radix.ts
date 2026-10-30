// nib's Radix Themes library: Radix Themes (MIT) components with its default look (indigo accent, slate
// gray, medium radius), drawn as .pen components. Colors are steps of Radix Colors' 12-step scales.
import { col, ellipse, frame, icon, Library, rect, ref, row, show, text, themedColors, type N } from './kit.ts';

const scale = (prefix: string, steps: string[]) => Object.fromEntries(steps.map((c, i) => [`${prefix}-${i + 1}`, c]));
const light = {
  ...scale('gray', ['#FCFCFD', '#F9F9FB', '#F0F0F3', '#E8E8EC', '#E0E1E6', '#D9D9E0', '#CDCED6', '#B9BBC6', '#8B8D98', '#80838D', '#60646C', '#1C2024']),
  ...scale('accent', ['#FDFDFE', '#F7F9FF', '#EDF2FE', '#E1E9FF', '#D2DEFF', '#C1D0FF', '#ABBDF9', '#8DA4EF', '#3E63DD', '#3358D4', '#3A5BC7', '#1F2D5C']),
  'green-3': '#E6F6EB', 'green-9': '#30A46C', 'green-11': '#218358',
  'red-3': '#FEEBEC', 'red-9': '#E5484D', 'red-11': '#CE2C31',
  background: '#FFFFFF', panel: '#FFFFFF', 'accent-contrast': '#FFFFFF', 'shadow-1': '#0000001A', 'shadow-2': '#0000000D',
};
const dark = {
  ...scale('gray', ['#111113', '#18191B', '#212225', '#272A2D', '#2E3135', '#363A3F', '#43484E', '#5A6169', '#696E77', '#777B84', '#B0B4BA', '#EDEEF0']),
  ...scale('accent', ['#11131F', '#141726', '#182449', '#1D2E62', '#253974', '#304384', '#3A4F97', '#435DB1', '#3E63DD', '#5472E4', '#9EB1FF', '#D6E1FF']),
  'green-3': '#132D21', 'green-9': '#30A46C', 'green-11': '#3DD68C',
  'red-3': '#3B1219', 'red-9': '#E5484D', 'red-11': '#FF9592',
  background: '#111113', panel: '#18191B', 'accent-contrast': '#FFFFFF', 'shadow-1': '#00000066', 'shadow-2': '#00000033',
};

const shadow = (y: number, blur: number, spread: number, color: string) => ({ type: 'shadow', offset: { x: 0, y }, blur, spread, color });
const lifted = [shadow(12, 32, -16, '$shadow-1'), shadow(12, 60, -12, '$shadow-2')];

const font = '$font-sans';
const t = (content: string, props: N = {}) => text(content, { fontFamily: font, fontSize: 14, lineHeight: 1.43, fill: '$gray-12', ...props });
const dim = (content: string, props: N = {}) => t(content, { fill: '$gray-11', ...props });
const heading = (content: string) => t(content, { fontSize: 24, fontWeight: '700', lineHeight: 1.25 });
const caption = (content: string) => t(content, { fontSize: 13, fill: '$gray-11' });
const group = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 16, alignItems: 'center' }, ...items));
const tall = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 24, alignItems: 'start' }, ...items));

export const meta = {
  id: 'radix',
  name: 'Radix Themes',
  summary: {
    en: 'Radix Themes: calm, accessible components on Radix Colors scales, with buttons, fields, callouts, segmented controls and a workspace screen.',
    zh: 'Radix Themes：基于 Radix Colors 色阶的沉稳、无障碍组件，包含按钮、输入框、提示、分段控件，以及一个工作区页面。',
  },
  basedOn: 'Radix Themes (indigo accent, slate gray)',
  license: 'MIT',
  homepage: 'https://www.radix-ui.com/themes',
  /** Which variables follow a brand's color, radius and font (see the daemon's brand.ts). */
  brand: { anchor: 'accent-9', radius: 'radius-3', font: 'font-sans', vars: { ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 10, 11, 12].map((n) => [`accent-${n}`, 'recolor'])), 'accent-contrast': 'on' } },
};

export function radix(): Library {
  const lib = new Library('radix', { Mode: ['Light', 'Dark'] });
  Object.assign(lib.variables, themedColors(light, dark), {
    'font-sans': { type: 'string', value: 'Inter' },
    'radius-1': { type: 'number', value: 3 }, 'radius-2': { type: 'number', value: 4 }, 'radius-3': { type: 'number', value: 6 }, 'radius-4': { type: 'number', value: 8 }, 'radius-5': { type: 'number', value: 12 },
  });

  // Buttons --------------------------------------------------------------------------------------
  const button = (id: string, name: string, look: N, ink: string, size: 1 | 2 | 3 = 2) => lib.component(id, name, row({
    height: size === 1 ? 24 : size === 3 ? 40 : 32, padding: [0, size === 1 ? 8 : size === 3 ? 16 : 12], gap: size === 1 ? 4 : 8,
    alignItems: 'center', justifyContent: 'center', cornerRadius: size === 1 ? '$radius-1' : size === 3 ? '$radius-3' : '$radius-2', ...look,
  }, t('Button', { id: `${id}-label`, fill: ink, fontWeight: '500', ...(size === 1 ? { fontSize: 12, lineHeight: 1.33 } : size === 3 ? { fontSize: 16, lineHeight: 1.5 } : {}) })));
  button('button', 'Button / Solid', { fill: '$accent-9' }, '$accent-contrast');
  button('button-soft', 'Button / Soft', { fill: '$accent-3' }, '$accent-11');
  button('button-surface', 'Button / Surface', { fill: '$accent-2', stroke: '$accent-7', strokeWidth: 1 }, '$accent-11');
  button('button-outline', 'Button / Outline', { stroke: '$accent-8', strokeWidth: 1 }, '$accent-11');
  button('button-ghost', 'Button / Ghost', {}, '$accent-11');
  button('button-gray', 'Button / Gray', { fill: '$gray-3' }, '$gray-12');
  button('button-red', 'Button / Red', { fill: '$red-9' }, '$accent-contrast');
  button('button-small', 'Button / Small', { fill: '$accent-9' }, '$accent-contrast', 1);
  button('button-large', 'Button / Large', { fill: '$accent-9' }, '$accent-contrast', 3);
  lib.component('icon-button', 'Icon Button', row({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-2', fill: '$accent-3' },
    icon('bell', { id: 'icon-button-glyph', fill: '$accent-11' })));
  lib.component('button-with-icon', 'Button / With Icon', row({ height: 32, padding: [0, 12], gap: 8, alignItems: 'center', cornerRadius: '$radius-2', fill: '$accent-9' },
    icon('bookmark', { id: 'button-with-icon-glyph', fill: '$accent-contrast' }), t('Bookmark', { id: 'button-with-icon-label', fill: '$accent-contrast', fontWeight: '500' })));

  // Form controls --------------------------------------------------------------------------------
  const field = { height: 32, padding: [0, 8], gap: 6, alignItems: 'center', cornerRadius: '$radius-2', fill: '$background', stroke: '$gray-7', strokeWidth: 1 };
  lib.component('text-field', 'Text Field', row({ ...field, width: 260 }, t('Search the docs…', { id: 'text-field-text', fill: '$gray-9', width: 'fill_container' })));
  lib.component('text-field-icon', 'Text Field / With Icon', row({ ...field, width: 260 }, icon('search', { id: 'text-field-icon-glyph', fill: '$gray-11' }), t('Search the docs…', { id: 'text-field-icon-text', fill: '$gray-9', width: 'fill_container' })));
  lib.component('text-area', 'Text Area', row({ ...field, height: 80, width: 260, alignItems: 'start', padding: [6, 8] }, t('Reply to comment…', { id: 'text-area-text', fill: '$gray-9', width: 'fill_container' })));
  lib.component('select', 'Select', row({ ...field, width: 180, padding: [0, 12], justifyContent: 'space_between' }, t('Apple', { id: 'select-text' }), icon('chevron-down', { width: 12, height: 12, fill: '$gray-11' })));
  const box = (on: boolean): N => frame({ width: 16, height: 16, cornerRadius: '$radius-1', layout: 'horizontal', alignItems: 'center', justifyContent: 'center',
    ...(on ? { fill: '$accent-9' } : { fill: '$background', stroke: '$gray-7', strokeWidth: 1 }) }, ...(on ? [icon('check', { width: 12, height: 12, fill: '$accent-contrast' })] : []));
  lib.component('checkbox', 'Checkbox / Checked', row({ gap: 8, alignItems: 'center' }, box(true), t('Agree to Terms and Conditions', { id: 'checkbox-label' })));
  lib.component('checkbox-off', 'Checkbox / Unchecked', row({ gap: 8, alignItems: 'center' }, box(false), t('Remember me', { id: 'checkbox-off-label' })));
  const radio = (on: boolean): N => frame({ width: 16, height: 16, cornerRadius: 8, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', ...(on ? { fill: '$accent-9' } : { fill: '$background', stroke: '$gray-7', strokeWidth: 1 }) },
    ...(on ? [ellipse({ width: 6, height: 6, fill: '$accent-contrast' })] : []));
  lib.component('radio', 'Radio / Checked', row({ gap: 8, alignItems: 'center' }, radio(true), t('Default', { id: 'radio-label' })));
  lib.component('radio-off', 'Radio / Unchecked', row({ gap: 8, alignItems: 'center' }, radio(false), t('Comfortable', { id: 'radio-off-label' })));
  const sw = (on: boolean): N => frame({ width: 42, height: 24, cornerRadius: 12, layout: 'horizontal', alignItems: 'center', justifyContent: on ? 'end' : 'start', padding: 2, fill: on ? '$accent-9' : '$gray-5' },
    ellipse({ width: 20, height: 20, fill: '#FFFFFF', effect: shadow(1, 2, 0, '$shadow-1') }));
  lib.component('switch', 'Switch / On', row({ gap: 8, alignItems: 'center' }, sw(true), t('Sync settings', { id: 'switch-label' })));
  lib.component('switch-off', 'Switch / Off', row({ gap: 8, alignItems: 'center' }, sw(false), t('Beta features', { id: 'switch-off-label' })));
  lib.component('slider', 'Slider', frame({ width: 240, height: 20, layout: 'none' },
    rect({ x: 0, y: 7, width: 240, height: 6, cornerRadius: 3, fill: '$gray-4' }),
    rect({ id: 'slider-range', x: 0, y: 7, width: 120, height: 6, cornerRadius: 3, fill: '$accent-9' }),
    ellipse({ id: 'slider-thumb', x: 110, y: 0, width: 20, height: 20, fill: '#FFFFFF', stroke: '$gray-7', strokeWidth: 1, effect: shadow(1, 2, 0, '$shadow-1') })));
  const seg = (id: string, label: string, on: boolean): N => row({ id, height: 26, padding: [0, 12], alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-1', width: 'fill_container',
    ...(on ? { fill: '$background', effect: shadow(1, 3, 0, '$shadow-1') } : {}) }, t(label, { id: `${id}-label`, fontWeight: on ? '500' : '400', fill: on ? '$gray-12' : '$gray-11' }));
  lib.component('segmented', 'Segmented Control', row({ width: 300, height: 32, padding: 3, cornerRadius: '$radius-2', fill: '$gray-3' }, seg('segmented-1', 'Inbox', true), seg('segmented-2', 'Drafts', false), seg('segmented-3', 'Sent', false)));

  // Display --------------------------------------------------------------------------------------
  const badge = (id: string, name: string, bg: string, ink: string, label: string) => lib.component(id, name, row({ height: 20, padding: [0, 6], alignItems: 'center', cornerRadius: '$radius-1', fill: bg },
    t(label, { id: `${id}-label`, fontSize: 12, lineHeight: 1.33, fontWeight: '500', fill: ink })));
  badge('badge', 'Badge / Accent', '$accent-3', '$accent-11', 'In progress');
  badge('badge-green', 'Badge / Green', '$green-3', '$green-11', 'Complete');
  badge('badge-red', 'Badge / Red', '$red-3', '$red-11', 'Overdue');
  badge('badge-gray', 'Badge / Gray', '$gray-3', '$gray-11', 'Draft');
  lib.component('avatar', 'Avatar', row({ width: 32, height: 32, cornerRadius: '$radius-2', fill: '$accent-3', alignItems: 'center', justifyContent: 'center', clip: true },
    t('A', { id: 'avatar-fallback', fill: '$accent-11', fontWeight: '500' })));
  lib.component('kbd', 'Kbd', row({ height: 20, padding: [0, 5], cornerRadius: '$radius-1', fill: '$gray-1', stroke: '$gray-7', strokeWidth: 1, alignItems: 'center' }, t('⌘ K', { id: 'kbd-text', fontSize: 12, lineHeight: 1.33 })));
  lib.component('code', 'Code', row({ padding: [1, 5], cornerRadius: '$radius-1', fill: '$accent-3' }, t('npm install @radix-ui/themes', { id: 'code-text', fontFamily: 'JetBrains Mono', fontSize: 13, fill: '$accent-11' })));
  lib.component('separator', 'Separator', rect({ width: 280, height: 1, fill: '$gray-6' }));
  lib.component('progress', 'Progress', frame({ width: 240, height: 6, cornerRadius: 3, fill: '$gray-4', layout: 'none', clip: true }, rect({ id: 'progress-indicator', x: 0, y: 0, width: 150, height: 6, fill: '$accent-9' })));
  const callout = (id: string, name: string, color: 'accent' | 'red', glyph: string, msg: string) => lib.component(id, name, row({ width: 420, padding: 16, gap: 12, alignItems: 'start', cornerRadius: '$radius-3', fill: `$${color}-3` },
    icon(glyph, { id: `${id}-icon`, fill: `$${color}-11` }), t(msg, { id: `${id}-text`, width: 'fill_container', fill: `$${color}-11` })));
  callout('callout', 'Callout / Accent', 'accent', 'info', 'You will need admin privileges to install and access this application.');
  callout('callout-red', 'Callout / Red', 'red', 'triangle-alert', 'Access denied. Please contact the network administrator.');
  lib.component('card', 'Card', row({ width: 320, padding: 16, gap: 12, alignItems: 'center', cornerRadius: '$radius-4', fill: '$panel', stroke: '$gray-6', strokeWidth: 1 },
    ref('avatar', { id: 'card-avatar', width: 40, height: 40, cornerRadius: 20 }, { 'avatar-fallback': { content: 'T' } }),
    col({ id: 'card-content', gap: 0, width: 'fill_container' }, t('Teodros Girmay', { id: 'card-title', fontWeight: '700' }), dim('Engineering', { id: 'card-description' }))));
  const people: [string, string, string, string][] = [['Danilo Sousa', 'danilo@example.com', 'Developer', 'badge-green'], ['Zahra Ambessa', 'zahra@example.com', 'Admin', 'badge'], ['Jasper Eriksson', 'jasper@example.com', 'Developer', 'badge-gray']];
  const status: Record<string, string> = { 'badge-green': 'Active', badge: 'Invited', 'badge-gray': 'Away' };
  const td = (child: N, w: N = { width: 'fill_container' }) => row({ ...w, padding: [10, 12], alignItems: 'center' }, child);
  lib.component('table', 'Table', col({ width: 620, cornerRadius: '$radius-4', fill: '$panel', stroke: '$gray-6', strokeWidth: 1, clip: true },
    row({ width: 'fill_container', stroke: '$gray-6', strokeWidth: { bottom: 1 } }, td(t('Full name', { fontWeight: '700' })), td(t('Email', { fontWeight: '700' })), td(t('Group', { fontWeight: '700' }), { width: 110 }), td(t('Status', { fontWeight: '700' }), { width: 110 })),
    ...people.map(([n, e, g, b], i) => row({ id: `table-row-${i + 1}`, width: 'fill_container', ...(i < people.length - 1 ? { stroke: '$gray-6', strokeWidth: { bottom: 1 } } : {}) },
      td(t(n)), td(dim(e)), td(t(g), { width: 110 }), td(ref(b, {}, { [`${b}-label`]: { content: status[b] } }), { width: 110 })))));

  // Navigation and overlays ----------------------------------------------------------------------
  const tab = (id: string, label: string, on: boolean): N => col({ id, alignItems: 'center' },
    row({ height: 38, padding: [0, 10], alignItems: 'center' }, t(label, { id: `${id}-label`, fontWeight: on ? '500' : '400', fill: on ? '$gray-12' : '$gray-11' })),
    rect({ width: 'fill_container', height: 2, fill: on ? '$accent-10' : '#00000000' }));
  lib.component('tabs', 'Tabs', row({ width: 360, stroke: '$gray-6', strokeWidth: { bottom: 1 } }, tab('tabs-1', 'Account', true), tab('tabs-2', 'Documents', false), tab('tabs-3', 'Settings', false)));
  const item = (label: string, keys?: string, red = false, on = false): N => row({ height: 32, padding: [0, 12], alignItems: 'center', justifyContent: 'space_between', width: 'fill_container', cornerRadius: '$radius-2', ...(on ? { fill: '$accent-9' } : {}) },
    t(label, { fill: on ? '$accent-contrast' : red ? '$red-11' : '$gray-12' }), ...(keys ? [t(keys, { fill: on ? '$accent-contrast' : '$gray-11' })] : []));
  lib.component('dropdown', 'Dropdown Menu', col({ width: 200, padding: 8, gap: 0, cornerRadius: '$radius-4', fill: '$panel', stroke: '$gray-6', strokeWidth: 1, effect: lifted },
    item('Edit', '⌘ E', false, true), item('Duplicate', '⌘ D'), rect({ width: 'fill_container', height: 1, fill: '$gray-6' }), item('Archive', '⌘ N'), item('Delete', '⌘ ⌫', true)));
  lib.component('dialog', 'Dialog', col({ width: 450, padding: 24, gap: 16, cornerRadius: '$radius-5', fill: '$panel', effect: lifted },
    col({ gap: 4, width: 'fill_container' }, t('Edit profile', { id: 'dialog-title', fontSize: 20, fontWeight: '700', lineHeight: 1.4 }), dim('Make changes to your profile.', { id: 'dialog-description' })),
    col({ gap: 4, width: 'fill_container' }, t('Name', { fontWeight: '700' }), ref('text-field', { id: 'dialog-name', width: 'fill_container' }, { 'text-field-text': { content: 'Freja Johnsen', fill: '$gray-12' } })),
    col({ gap: 4, width: 'fill_container' }, t('Email', { fontWeight: '700' }), ref('text-field', { id: 'dialog-email', width: 'fill_container' }, { 'text-field-text': { content: 'freja@example.com', fill: '$gray-12' } })),
    row({ gap: 12, justifyContent: 'end', width: 'fill_container' }, ref('button-gray', { id: 'dialog-cancel' }, { 'button-gray-label': { content: 'Cancel' } }), ref('button', { id: 'dialog-save' }, { 'button-label': { content: 'Save' } }))));
  lib.component('tooltip', 'Tooltip', row({ padding: [5, 8], cornerRadius: '$radius-2', fill: '$gray-12' }, t('Add to library', { id: 'tooltip-text', fontSize: 12, lineHeight: 1.33, fill: '$gray-1' })));

  // Boards ---------------------------------------------------------------------------------------
  lib.board('board-buttons', 'Buttons', {}, heading('Buttons'),
    group('Variants', show('button'), show('button-soft'), show('button-surface'), show('button-outline'), show('button-ghost'), show('button-gray'), show('button-red')),
    group('Sizes and icons', show('button-small'), show('button-large'), show('icon-button'), show('button-with-icon')),
    group('Badges and more', show('badge'), show('badge-green'), show('badge-red'), show('badge-gray'), show('avatar'), show('kbd'), show('code'), show('tooltip')));
  lib.board('board-forms', 'Forms', {}, heading('Forms'),
    tall('Fields', show('text-field'), show('text-field-icon'), show('text-area'), show('select')),
    group('Choices', show('checkbox'), show('checkbox-off'), show('radio'), show('radio-off'), show('switch'), show('switch-off')),
    group('Range and segments', show('slider'), show('progress'), show('segmented')));
  lib.board('board-layout', 'Layout and overlays', {}, heading('Layout and overlays'),
    tall('Callouts', col({ gap: 12 }, show('callout'), show('callout-red')), show('card')),
    tall('Tabs and separator', show('tabs'), show('separator')),
    tall('Overlays', show('dropdown'), show('dialog')),
    tall('Table', show('table')));

  // The overview a new design starts from: a project workspace.
  const nav = (glyph: string, label: string, on = false): N => row({ height: 32, padding: [0, 8], gap: 8, alignItems: 'center', width: 'fill_container', cornerRadius: '$radius-2', ...(on ? { fill: '$accent-3' } : {}) },
    icon(glyph, { fill: on ? '$accent-11' : '$gray-11' }), t(label, { fill: on ? '$accent-11' : '$gray-12', fontWeight: on ? '500' : '400' }));
  // States (Radix Themes: hover one step up the scale, active "brightness(0.92)" on solid buttons as a dark
  // overlay, a 2px focus outline in accent-8 offset by 2px, disabled in gray-a3 with gray-a8 text) ------
  const outline = [{ type: 'shadow', offset: { x: 0, y: 0 }, blur: 0, spread: 4, color: '$accent-8' }, { type: 'shadow', offset: { x: 0, y: 0 }, blur: 0, spread: 2, color: '$background' }];
  const disabled = (label: string) => ({ props: { fill: '$gray-3', stroke: '#00000000', effect: [] }, parts: { [label]: { fill: '$gray-8' } } });
  const press = (fill: string) => [fill, '#00000014'];
  const looks: [string, string, string | string[], boolean][] = [
    ['button', '$accent-10', press('$accent-10'), true], ['button-soft', '$accent-4', '$accent-5', false], ['button-surface', '$accent-3', '$accent-4', false],
    ['button-outline', '$accent-2', '$accent-3', false], ['button-ghost', '$accent-3', '$accent-4', false], ['button-gray', '$gray-4', '$gray-5', false],
    ['button-red', '$red-9', press('$red-9'), true],
  ];
  for (const [id, hover, pressed, solid] of looks) {
    lib.states(id, {
      hover: { props: { fill: id === 'button-red' ? ['$red-9', '#0000000D'] : hover } }, pressed: { props: { fill: pressed } },
      // The outline is drawn from what the button paints: buttons without a fill take the page color.
      focus: { props: { effect: outline, ...(solid || id !== 'button-outline' && id !== 'button-ghost' ? {} : { fill: '$background' }) } },
      disabled: disabled(`${id}-label`),
    });
  }
  for (const id of ['text-field', 'select']) {
    lib.states(id, {
      focus: { props: { stroke: '$accent-8', strokeWidth: 2 } },
      invalid: { props: { stroke: '$red-9' }, code: 'color="red"' },
      disabled: { props: { fill: '$gray-2', stroke: '$gray-6' }, parts: { [`${id}-text`]: { fill: '$gray-8' } } },
    });
  }
  for (const id of ['checkbox-off', 'switch-off']) lib.states(id, { disabled: { props: { opacity: 0.5 } } });
  const states = (id: string) => group(lib.components.get(id)!.name as string, ref(id), ...lib.statesOf(id).map((s) => show(s)));
  lib.board('board-states', 'States', {}, heading('States'),
    caption('Hover, pressed, focus, invalid and disabled, each a component made from its base: changes to the base carry over.'),
    ...[...looks.map(([id]) => id), 'text-field', 'select', 'checkbox-off', 'switch-off'].map(states));

  lib.board('overview', 'Overview', { width: 1440, height: 900, padding: 0, gap: 0, layout: 'horizontal', clip: true, fill: '$gray-1' },
    col({ width: 240, height: 'fill_container', padding: 12, gap: 4, fill: '$gray-2', stroke: '$gray-6', strokeWidth: { right: 1 } },
      row({ height: 40, padding: [0, 8], gap: 8, alignItems: 'center', width: 'fill_container' }, row({ width: 24, height: 24, cornerRadius: '$radius-2', fill: '$accent-9', alignItems: 'center', justifyContent: 'center' }, icon('box', { width: 14, height: 14, fill: '$accent-contrast' })), t('Northwind', { fontWeight: '700' })),
      nav('inbox', 'Inbox'), nav('folder-kanban', 'Projects', true), nav('users', 'Team'), nav('settings', 'Settings')),
    col({ width: 'fill_container', height: 'fill_container', padding: [32, 40], gap: 24 },
      row({ width: 'fill_container', alignItems: 'center', justifyContent: 'space_between' },
        col({ gap: 4 }, t('Projects', { fontSize: 28, fontWeight: '700', lineHeight: 1.2 }), dim('Track work across your team.')),
        row({ gap: 8, alignItems: 'center' }, ref('text-field-icon', { id: 'overview-search', width: 240 }, { 'text-field-icon-text': { content: 'Search projects…' } }), ref('button-with-icon', { id: 'overview-new' }, { 'button-with-icon-glyph': { icon: 'plus' }, 'button-with-icon-label': { content: 'New project' } }))),
      ref('segmented', { id: 'overview-filter' }, { 'segmented-1-label': { content: 'All' }, 'segmented-2-label': { content: 'Active' }, 'segmented-3-label': { content: 'Archived' } }),
      ref('callout', { id: 'overview-callout', width: 'fill_container' }, { 'callout-text': { content: 'Three projects are due this week. Review their status before Friday.' } }),
      row({ width: 'fill_container', gap: 16 },
        ...[['Website refresh', 'Marketing', 'badge', 'In progress', 'R'], ['Mobile app 2.0', 'Product', 'badge-green', 'Complete', 'M'], ['Data warehouse', 'Engineering', 'badge-red', 'Overdue', 'D']].map(([title, team, b, label, l], i) => col({ id: `overview-project-${i + 1}`, width: 'fill_container', padding: 16, gap: 12, cornerRadius: '$radius-4', fill: '$panel', stroke: '$gray-6', strokeWidth: 1 },
          row({ width: 'fill_container', justifyContent: 'space_between', alignItems: 'center' }, ref('avatar', { id: `overview-project-${i + 1}-avatar` }, { 'avatar-fallback': { content: l } }), ref(b, { id: `overview-project-${i + 1}-badge` }, { [`${b}-label`]: { content: label } })),
          col({ gap: 2, width: 'fill_container' }, t(title, { fontWeight: '700' }), dim(team)),
          ref('progress', { id: `overview-project-${i + 1}-progress`, width: 'fill_container' })))),
      ref('table', { id: 'overview-table', width: 'fill_container' })));
  code(lib);
  return lib;
}

export const codeMeta = { library: 'Radix Themes', setup: 'npm install @radix-ui/themes, import "@radix-ui/themes/styles.css" and wrap the app in <Theme accentColor="indigo" grayColor="slate">', inherited: ['font-sans'] };

/** Radix Themes components as their code: https://www.radix-ui.com/themes/docs. */
function code(lib: Library) {
  const rx = (...names: string[]) => Object.fromEntries(names.map((n) => [n, '@radix-ui/themes']));
  for (const [id, props] of [['button', ''], ['button-soft', ' variant="soft"'], ['button-surface', ' variant="surface"'], ['button-outline', ' variant="outline"'], ['button-ghost', ' variant="ghost"'],
    ['button-gray', ' color="gray" variant="soft"'], ['button-red', ' color="red"'], ['button-small', ' size="1"'], ['button-large', ' size="3"']]) {
    lib.codeFor(id, `<Button${props}{class}>{text:${id}-label}</Button>`, rx('Button'));
  }
  lib.codeFor('icon-button', '<IconButton variant="soft"{class}>{icon:icon-button-glyph}</IconButton>', rx('IconButton'));
  lib.codeFor('button-with-icon', '<Button{class}>{icon:button-with-icon-glyph} {text:button-with-icon-label}</Button>', rx('Button'));
  lib.codeFor('text-field', '<TextField.Root placeholder="{attr:text-field-text}"{class} />', rx('TextField'));
  lib.codeFor('text-field-icon', '<TextField.Root placeholder="{attr:text-field-icon-text}"{class}>\n  <TextField.Slot>{icon:text-field-icon-glyph}</TextField.Slot>\n</TextField.Root>', rx('TextField'));
  lib.codeFor('text-area', '<TextArea placeholder="{attr:text-area-text}"{class} />', rx('TextArea'));
  lib.codeFor('select', '<Select.Root defaultValue="{slug:select-text}">\n  <Select.Trigger{class} />\n  <Select.Content>\n    <Select.Item value="{slug:select-text}">{text:select-text}</Select.Item>\n  </Select.Content>\n</Select.Root>', rx('Select'));
  for (const [id, on] of [['checkbox', ' defaultChecked'], ['checkbox-off', '']]) {
    lib.codeFor(id, `<Text as="label" size="2"{class}>\n  <Flex gap="2">\n    <Checkbox${on} />\n    {text:${id}-label}\n  </Flex>\n</Text>`, rx('Checkbox', 'Flex', 'Text'));
  }
  for (const id of ['radio', 'radio-off']) {
    lib.codeFor(id, `<RadioGroup.Root${id === 'radio' ? ' defaultValue="{slug:radio-label}"' : ''}{class}>\n  <RadioGroup.Item value="{slug:${id}-label}">{text:${id}-label}</RadioGroup.Item>\n</RadioGroup.Root>`, rx('RadioGroup'));
  }
  for (const [id, on] of [['switch', ' defaultChecked'], ['switch-off', '']]) {
    lib.codeFor(id, `<Text as="label" size="2"{class}>\n  <Flex gap="2">\n    <Switch${on} />\n    {text:${id}-label}\n  </Flex>\n</Text>`, rx('Flex', 'Switch', 'Text'));
  }
  lib.codeFor('slider', '<Slider defaultValue={[50]}{class} />', rx('Slider'));
  lib.codeFor('segmented', '<SegmentedControl.Root defaultValue="{slug:segmented-1-label}"{class}>\n  <SegmentedControl.Item value="{slug:segmented-1-label}">{text:segmented-1-label}</SegmentedControl.Item>\n  <SegmentedControl.Item value="{slug:segmented-2-label}">{text:segmented-2-label}</SegmentedControl.Item>\n  <SegmentedControl.Item value="{slug:segmented-3-label}">{text:segmented-3-label}</SegmentedControl.Item>\n</SegmentedControl.Root>', rx('SegmentedControl'));
  for (const [id, color] of [['badge', ''], ['badge-green', ' color="green"'], ['badge-red', ' color="red"'], ['badge-gray', ' color="gray"']]) {
    lib.codeFor(id, `<Badge${color}{class}>{text:${id}-label}</Badge>`, rx('Badge'));
  }
  lib.codeFor('avatar', '<Avatar fallback="{attr:avatar-fallback}"{class} />', rx('Avatar'));
  lib.codeFor('kbd', '<Kbd{class}>{text:kbd-text}</Kbd>', rx('Kbd'));
  lib.codeFor('code', '<Code{class}>{text:code-text}</Code>', rx('Code'));
  lib.codeFor('separator', '<Separator size="4"{class} />', rx('Separator'));
  lib.codeFor('progress', '<Progress value={60}{class} />', rx('Progress'));
  for (const [id, color] of [['callout', ''], ['callout-red', ' color="red"']]) {
    lib.codeFor(id, `<Callout.Root${color}{class}>\n  <Callout.Icon>{icon:${id}-icon}</Callout.Icon>\n  <Callout.Text>{text:${id}-text}</Callout.Text>\n</Callout.Root>`, rx('Callout'));
  }
  lib.codeFor('card', '<Card{class}>\n  <Flex gap="3" align="center">\n    <Avatar size="3" radius="full" fallback="{attr:card-avatar/avatar-fallback}" />\n    <Box>\n      <Text as="div" size="2" weight="bold">{text:card-title}</Text>\n      <Text as="div" size="2" color="gray">{text:card-description}</Text>\n    </Box>\n  </Flex>\n</Card>', rx('Avatar', 'Box', 'Card', 'Flex', 'Text'));
  lib.codeFor('tabs', '<Tabs.Root defaultValue="{slug:tabs-1-label}"{class}>\n  <Tabs.List>\n    <Tabs.Trigger value="{slug:tabs-1-label}">{text:tabs-1-label}</Tabs.Trigger>\n    <Tabs.Trigger value="{slug:tabs-2-label}">{text:tabs-2-label}</Tabs.Trigger>\n    <Tabs.Trigger value="{slug:tabs-3-label}">{text:tabs-3-label}</Tabs.Trigger>\n  </Tabs.List>\n</Tabs.Root>', rx('Tabs'));
}
