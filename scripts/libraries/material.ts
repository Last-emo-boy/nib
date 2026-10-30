// nib's Material 3 library: Material Design 3 components (specs at m3.material.io; Material Web, Apache-2.0,
// for code) with the baseline color scheme, drawn as .pen components for phone-first designs.
import { col, ellipse, frame, icon, Library, rect, ref, row, show, text, themedColors, type N } from './kit.ts';

const light = {
  primary: '#6750A4', 'on-primary': '#FFFFFF', 'primary-container': '#EADDFF', 'on-primary-container': '#21005D',
  secondary: '#625B71', 'on-secondary': '#FFFFFF', 'secondary-container': '#E8DEF8', 'on-secondary-container': '#1D192B',
  tertiary: '#7D5260', 'tertiary-container': '#FFD8E4', 'on-tertiary-container': '#31111D',
  error: '#B3261E', 'on-error': '#FFFFFF', 'error-container': '#F9DEDC', 'on-error-container': '#410E0B',
  surface: '#FEF7FF', 'on-surface': '#1D1B20', 'on-surface-variant': '#49454F',
  'surface-container-lowest': '#FFFFFF', 'surface-container-low': '#F7F2FA', 'surface-container': '#F3EDF7', 'surface-container-high': '#ECE6F0', 'surface-container-highest': '#E6E0E9',
  outline: '#79747E', 'outline-variant': '#CAC4D0', 'inverse-surface': '#322F35', 'inverse-on-surface': '#F5EFF7', 'inverse-primary': '#D0BCFF',
  'shadow-1': '#0000004D', 'shadow-2': '#00000026',
};
const dark = {
  primary: '#D0BCFF', 'on-primary': '#381E72', 'primary-container': '#4F378B', 'on-primary-container': '#EADDFF',
  secondary: '#CCC2DC', 'on-secondary': '#332D41', 'secondary-container': '#4A4458', 'on-secondary-container': '#E8DEF8',
  tertiary: '#EFB8C8', 'tertiary-container': '#633B48', 'on-tertiary-container': '#FFD8E4',
  error: '#F2B8B5', 'on-error': '#601410', 'error-container': '#8C1D18', 'on-error-container': '#F9DEDC',
  surface: '#141218', 'on-surface': '#E6E0E9', 'on-surface-variant': '#CAC4D0',
  'surface-container-lowest': '#0F0D13', 'surface-container-low': '#1D1B20', 'surface-container': '#211F26', 'surface-container-high': '#2B2930', 'surface-container-highest': '#36343B',
  outline: '#938F99', 'outline-variant': '#49454F', 'inverse-surface': '#E6E0E9', 'inverse-on-surface': '#322F35', 'inverse-primary': '#6750A4',
  'shadow-1': '#00000099', 'shadow-2': '#0000004D',
};

const shadow = (y: number, blur: number, spread: number, color: string) => ({ type: 'shadow', offset: { x: 0, y }, blur, spread, color });
/** Material elevation levels 1 and 3. */
const level1 = [shadow(1, 2, 0, '$shadow-1'), shadow(1, 3, 1, '$shadow-2')];
const level3 = [shadow(1, 3, 0, '$shadow-1'), shadow(4, 8, 3, '$shadow-2')];

const font = '$font-sans';
/** Material type scale roles. */
const type = {
  headline: { fontSize: 24, lineHeight: 1.33 }, title: { fontSize: 22, lineHeight: 1.27 }, 'title-m': { fontSize: 16, fontWeight: '500', lineHeight: 1.5, letterSpacing: 0.15 },
  body: { fontSize: 16, lineHeight: 1.5, letterSpacing: 0.5 }, 'body-m': { fontSize: 14, lineHeight: 1.43, letterSpacing: 0.25 },
  label: { fontSize: 14, fontWeight: '500', lineHeight: 1.43, letterSpacing: 0.1 }, 'label-s': { fontSize: 12, fontWeight: '500', lineHeight: 1.33, letterSpacing: 0.5 },
};
const t = (content: string, role: keyof typeof type, props: N = {}) => text(content, { fontFamily: font, fill: '$on-surface', ...type[role], ...props });
const heading = (content: string) => t(content, 'headline', { fontWeight: '500' });
const caption = (content: string) => t(content, 'body-m', { fill: '$on-surface-variant' });
const group = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 16, alignItems: 'center' }, ...items));
const tall = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 24, alignItems: 'start' }, ...items));

export const meta = {
  id: 'material',
  name: 'Material 3',
  summary: {
    en: 'Material Design 3 for apps: pill buttons, FABs, chips, filled and outlined fields, lists, navigation bar and a phone screen to start from.',
    zh: '面向 App 的 Material Design 3：胶囊按钮、悬浮按钮、标签、填充和描边输入框、列表、底部导航，以及一个可直接起步的手机页面。',
  },
  basedOn: 'Material Design 3 (baseline scheme)',
  license: 'Apache-2.0',
  homepage: 'https://m3.material.io',
  /** Which variables follow a brand's color, radius and font (see the daemon's brand.ts). */
  brand: { anchor: 'primary', radius: 'shape-m', font: 'font-sans', vars: { 'on-primary': 'on', ...Object.fromEntries(['primary-container', 'on-primary-container', 'secondary', 'secondary-container', 'on-secondary-container', 'tertiary', 'tertiary-container', 'on-tertiary-container', 'surface', 'on-surface', 'on-surface-variant', 'surface-container-lowest', 'surface-container-low', 'surface-container', 'surface-container-high', 'surface-container-highest', 'outline', 'outline-variant', 'inverse-surface', 'inverse-on-surface', 'inverse-primary'].map((v) => [v, 'recolor'])) } },
};

export function material(): Library {
  const lib = new Library('material', { Mode: ['Light', 'Dark'] });
  Object.assign(lib.variables, themedColors(light, dark), {
    'font-sans': { type: 'string', value: 'Roboto' },
    'shape-xs': { type: 'number', value: 4 }, 'shape-s': { type: 'number', value: 8 }, 'shape-m': { type: 'number', value: 12 }, 'shape-l': { type: 'number', value: 16 }, 'shape-xl': { type: 'number', value: 28 },
  });

  // Buttons --------------------------------------------------------------------------------------
  const button = (id: string, name: string, look: N, ink: string, padding = 24) => lib.component(id, name, row({ height: 40, padding: [0, padding], gap: 8, alignItems: 'center', justifyContent: 'center', cornerRadius: 20, ...look },
    t('Button', 'label', { id: `${id}-label`, fill: ink })));
  button('button-filled', 'Button / Filled', { fill: '$primary' }, '$on-primary');
  button('button-tonal', 'Button / Tonal', { fill: '$secondary-container' }, '$on-secondary-container');
  button('button-outlined', 'Button / Outlined', { stroke: '$outline', strokeWidth: 1 }, '$primary');
  button('button-text', 'Button / Text', {}, '$primary', 12);
  button('button-elevated', 'Button / Elevated', { fill: '$surface-container-low', effect: level1 }, '$primary');
  lib.component('button-icon', 'Button / With Icon', row({ height: 40, padding: [0, 24, 0, 16], gap: 8, alignItems: 'center', cornerRadius: 20, fill: '$primary' },
    icon('plus', { id: 'button-icon-glyph', width: 18, height: 18, fill: '$on-primary' }), t('Add item', 'label', { id: 'button-icon-label', fill: '$on-primary' })));
  lib.component('fab', 'FAB', row({ width: 56, height: 56, cornerRadius: '$shape-l', fill: '$primary-container', alignItems: 'center', justifyContent: 'center', effect: level3 },
    icon('pencil', { id: 'fab-icon', width: 24, height: 24, fill: '$on-primary-container' })));
  lib.component('fab-extended', 'FAB / Extended', row({ height: 56, padding: [0, 20, 0, 16], gap: 12, cornerRadius: '$shape-l', fill: '$primary-container', alignItems: 'center', effect: level3 },
    icon('pencil', { id: 'fab-extended-icon', width: 24, height: 24, fill: '$on-primary-container' }), t('Compose', 'label', { id: 'fab-extended-label', fill: '$on-primary-container' })));
  lib.component('icon-button', 'Icon Button', row({ width: 40, height: 40, cornerRadius: 20, alignItems: 'center', justifyContent: 'center' }, icon('heart', { id: 'icon-button-glyph', width: 24, height: 24, fill: '$on-surface-variant' })));
  lib.component('icon-button-filled', 'Icon Button / Filled', row({ width: 40, height: 40, cornerRadius: 20, fill: '$primary', alignItems: 'center', justifyContent: 'center' }, icon('heart', { id: 'icon-button-filled-glyph', width: 24, height: 24, fill: '$on-primary' })));
  const segment = (id: string, label: string, on: boolean, last = false): N => row({ id, height: 40, padding: [0, 12], gap: 8, alignItems: 'center', justifyContent: 'center', width: 'fill_container', ...(on ? { fill: '$secondary-container' } : {}), ...(last ? {} : { stroke: '$outline', strokeWidth: { right: 1 } }) },
    ...(on ? [icon('check', { width: 18, height: 18, fill: '$on-secondary-container' })] : []), t(label, 'label', { id: `${id}-label`, fill: on ? '$on-secondary-container' : '$on-surface' }));
  lib.component('segmented', 'Segmented Button', row({ width: 330, cornerRadius: 20, stroke: '$outline', strokeWidth: 1, clip: true }, segment('segmented-1', 'Day', true), segment('segmented-2', 'Week', false), segment('segmented-3', 'Month', false, true)));

  // Chips ----------------------------------------------------------------------------------------
  lib.component('chip-assist', 'Chip / Assist', row({ height: 32, padding: [0, 16, 0, 8], gap: 8, alignItems: 'center', cornerRadius: '$shape-s', stroke: '$outline', strokeWidth: 1 },
    icon('calendar', { id: 'chip-assist-icon', width: 18, height: 18, fill: '$primary' }), t('Add to calendar', 'label', { id: 'chip-assist-label' })));
  lib.component('chip-filter', 'Chip / Filter Selected', row({ height: 32, padding: [0, 16, 0, 8], gap: 8, alignItems: 'center', cornerRadius: '$shape-s', fill: '$secondary-container' },
    icon('check', { width: 18, height: 18, fill: '$on-secondary-container' }), t('Starred', 'label', { id: 'chip-filter-label', fill: '$on-secondary-container' })));
  lib.component('chip-filter-off', 'Chip / Filter', row({ height: 32, padding: [0, 16], alignItems: 'center', cornerRadius: '$shape-s', stroke: '$outline', strokeWidth: 1 },
    t('Unread', 'label', { id: 'chip-filter-off-label', fill: '$on-surface-variant' })));
  lib.component('badge', 'Badge', row({ height: 16, padding: [0, 4], cornerRadius: 8, fill: '$error', alignItems: 'center', justifyContent: 'center' }, t('3', 'label-s', { id: 'badge-label', fontSize: 11, lineHeight: 1.45, fill: '$on-error' })));

  // Inputs ---------------------------------------------------------------------------------------
  lib.component('text-field', 'Text Field / Filled', col({ width: 280, height: 56, padding: [8, 16, 0, 16], gap: 0, cornerRadius: [4, 4, 0, 0], fill: '$surface-container-highest', stroke: '$on-surface-variant', strokeWidth: { bottom: 1 } },
    t('Label', 'label-s', { id: 'text-field-label', fontWeight: '400', fill: '$on-surface-variant' }), t('Input text', 'body', { id: 'text-field-value', width: 'fill_container' })));
  lib.component('text-field-outlined', 'Text Field / Outlined', frame({ width: 280, height: 64, layout: 'none' },
    frame({ x: 0, y: 8, width: 280, height: 56, cornerRadius: '$shape-xs', stroke: '$outline', strokeWidth: 1, layout: 'horizontal', alignItems: 'center', padding: [0, 16] }, t('Input text', 'body', { id: 'text-field-outlined-value', width: 'fill_container' })),
    row({ x: 12, y: 0, padding: [0, 4], fill: '$surface' }, t('Label', 'label-s', { id: 'text-field-outlined-label', fontWeight: '400', fill: '$on-surface-variant' }))));
  lib.component('search-bar', 'Search Bar', row({ width: 360, height: 56, padding: [0, 16], gap: 16, alignItems: 'center', cornerRadius: 28, fill: '$surface-container-high' },
    icon('menu', { width: 24, height: 24, fill: '$on-surface' }), t('Search mail', 'body', { id: 'search-bar-text', fill: '$on-surface-variant', width: 'fill_container' }),
    row({ width: 30, height: 30, cornerRadius: 15, fill: '$primary-container', alignItems: 'center', justifyContent: 'center' }, t('A', 'label', { id: 'search-bar-avatar', fill: '$on-primary-container' }))));
  const box = (on: boolean): N => frame({ width: 18, height: 18, cornerRadius: 2, layout: 'horizontal', alignItems: 'center', justifyContent: 'center',
    ...(on ? { fill: '$primary' } : { stroke: '$on-surface-variant', strokeWidth: 2 }) }, ...(on ? [icon('check', { width: 14, height: 14, fill: '$on-primary' })] : []));
  lib.component('checkbox', 'Checkbox / Checked', row({ gap: 12, alignItems: 'center' }, box(true), t('Remember me', 'body-m', { id: 'checkbox-label' })));
  lib.component('checkbox-off', 'Checkbox / Unchecked', row({ gap: 12, alignItems: 'center' }, box(false), t('Notify me', 'body-m', { id: 'checkbox-off-label' })));
  const radio = (on: boolean): N => frame({ width: 20, height: 20, cornerRadius: 10, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', stroke: on ? '$primary' : '$on-surface-variant', strokeWidth: 2 },
    ...(on ? [ellipse({ width: 10, height: 10, fill: '$primary' })] : []));
  lib.component('radio', 'Radio / Selected', row({ gap: 12, alignItems: 'center' }, radio(true), t('Standard', 'body-m', { id: 'radio-label' })));
  lib.component('radio-off', 'Radio / Unselected', row({ gap: 12, alignItems: 'center' }, radio(false), t('Express', 'body-m', { id: 'radio-off-label' })));
  lib.component('switch', 'Switch / On', row({ gap: 12, alignItems: 'center' },
    frame({ width: 52, height: 32, cornerRadius: 16, fill: '$primary', layout: 'horizontal', alignItems: 'center', justifyContent: 'end', padding: 4 },
      row({ width: 24, height: 24, cornerRadius: 12, fill: '$on-primary', alignItems: 'center', justifyContent: 'center' }, icon('check', { width: 16, height: 16, fill: '$on-primary-container' }))),
    t('Wi-Fi', 'body-m', { id: 'switch-label' })));
  lib.component('switch-off', 'Switch / Off', row({ gap: 12, alignItems: 'center' },
    frame({ width: 52, height: 32, cornerRadius: 16, fill: '$surface-container-highest', stroke: '$outline', strokeWidth: 2, layout: 'horizontal', alignItems: 'center', padding: [0, 6] },
      ellipse({ width: 16, height: 16, fill: '$outline' })),
    t('Bluetooth', 'body-m', { id: 'switch-off-label' })));
  lib.component('slider', 'Slider', frame({ width: 240, height: 20, layout: 'none' },
    rect({ x: 0, y: 8, width: 240, height: 4, cornerRadius: 2, fill: '$secondary-container' }),
    rect({ id: 'slider-active', x: 0, y: 8, width: 120, height: 4, cornerRadius: 2, fill: '$primary' }),
    ellipse({ id: 'slider-handle', x: 110, y: 0, width: 20, height: 20, fill: '$primary' })));
  lib.component('progress', 'Progress', frame({ width: 240, height: 4, cornerRadius: 2, fill: '$surface-container-highest', layout: 'none', clip: true }, rect({ id: 'progress-indicator', x: 0, y: 0, width: 144, height: 4, fill: '$primary' })));
  lib.component('divider', 'Divider', rect({ width: 320, height: 1, fill: '$outline-variant' }));

  // Containment ----------------------------------------------------------------------------------
  const cardBase = { width: 300, padding: 16, gap: 8, cornerRadius: '$shape-m' };
  const cardBody = (id: string) => [t('Card title', 'title-m', { id: `${id}-title` }), t('Supporting text that describes the card in a sentence or two.', 'body-m', { id: `${id}-text`, fill: '$on-surface-variant', width: 'fill_container' })];
  lib.component('card-filled', 'Card / Filled', col({ ...cardBase, fill: '$surface-container-highest' }, ...cardBody('card-filled')));
  lib.component('card-outlined', 'Card / Outlined', col({ ...cardBase, fill: '$surface', stroke: '$outline-variant', strokeWidth: 1 }, ...cardBody('card-outlined')));
  lib.component('card-elevated', 'Card / Elevated', col({ ...cardBase, fill: '$surface-container-low', effect: level1 }, ...cardBody('card-elevated')));
  lib.component('list-item', 'List Item', row({ width: 360, height: 72, padding: [0, 24, 0, 16], gap: 16, alignItems: 'center' },
    row({ width: 40, height: 40, cornerRadius: 20, fill: '$primary-container', alignItems: 'center', justifyContent: 'center' }, t('A', 'title-m', { id: 'list-item-avatar', fill: '$on-primary-container' })),
    col({ width: 'fill_container' }, t('Headline', 'body', { id: 'list-item-headline' }), t('Supporting text', 'body-m', { id: 'list-item-supporting', fill: '$on-surface-variant' })),
    t('10 min', 'label-s', { id: 'list-item-trailing', fontWeight: '400', fill: '$on-surface-variant' })));
  lib.component('dialog', 'Dialog', col({ width: 312, padding: 24, gap: 16, cornerRadius: '$shape-xl', fill: '$surface-container-high', effect: level3 },
    t('Reset settings?', 'headline', { id: 'dialog-headline' }),
    t('This will reset your app preferences back to their default settings.', 'body-m', { id: 'dialog-text', fill: '$on-surface-variant', width: 'fill_container' }),
    row({ width: 'fill_container', gap: 8, justifyContent: 'end' }, ref('button-text', { id: 'dialog-cancel' }, { 'button-text-label': { content: 'Cancel' } }), ref('button-text', { id: 'dialog-accept' }, { 'button-text-label': { content: 'Accept' } }))));
  lib.component('snackbar', 'Snackbar', row({ width: 344, height: 48, padding: [0, 8, 0, 16], gap: 8, alignItems: 'center', cornerRadius: '$shape-xs', fill: '$inverse-surface', effect: level3 },
    t('Photo has been archived', 'body-m', { id: 'snackbar-text', fill: '$inverse-on-surface', width: 'fill_container' }), t('Undo', 'label', { id: 'snackbar-action', fill: '$inverse-primary' })));
  lib.component('menu', 'Menu', col({ width: 200, padding: [8, 0], cornerRadius: '$shape-xs', fill: '$surface-container', effect: level3 },
    ...['Share', 'Rename', 'Archive', 'Delete'].map((s) => row({ height: 48, padding: [0, 12], alignItems: 'center', width: 'fill_container' }, t(s, 'label')))));

  // Navigation -----------------------------------------------------------------------------------
  lib.component('top-app-bar', 'Top App Bar', row({ width: 412, height: 64, padding: [0, 4], gap: 4, alignItems: 'center', fill: '$surface' },
    ref('icon-button', { id: 'top-app-bar-nav' }, { 'icon-button-glyph': { icon: 'arrow-left', fill: '$on-surface' } }),
    t('Title', 'title', { id: 'top-app-bar-title', width: 'fill_container' }),
    ref('icon-button', { id: 'top-app-bar-action' }, { 'icon-button-glyph': { icon: 'ellipsis-vertical', fill: '$on-surface-variant' } })));
  const navItem = (id: string, glyph: string, label: string, on: boolean): N => col({ id, width: 'fill_container', gap: 4, alignItems: 'center', padding: [12, 0, 16, 0] },
    row({ width: 64, height: 32, cornerRadius: 16, alignItems: 'center', justifyContent: 'center', ...(on ? { fill: '$secondary-container' } : {}) }, icon(glyph, { id: `${id}-icon`, width: 24, height: 24, fill: on ? '$on-secondary-container' : '$on-surface-variant' })),
    t(label, 'label-s', { id: `${id}-label`, fill: on ? '$on-surface' : '$on-surface-variant' }));
  lib.component('navigation-bar', 'Navigation Bar', row({ width: 412, height: 80, fill: '$surface-container' },
    navItem('nav-1', 'mail', 'Mail', true), navItem('nav-2', 'message-circle', 'Chat', false), navItem('nav-3', 'users', 'Rooms', false), navItem('nav-4', 'video', 'Meet', false)));
  const tab = (id: string, label: string, on: boolean): N => col({ id, width: 'fill_container', height: 48, alignItems: 'center', justifyContent: 'end' },
    row({ height: 45, alignItems: 'center' }, t(label, 'label', { id: `${id}-label`, fill: on ? '$primary' : '$on-surface-variant' })),
    rect({ width: 48, height: 3, cornerRadius: [3, 3, 0, 0], fill: on ? '$primary' : '#00000000' }));
  lib.component('tabs', 'Tabs', row({ width: 412, fill: '$surface', stroke: '$surface-container-highest', strokeWidth: { bottom: 1 } }, tab('tabs-1', 'Video', true), tab('tabs-2', 'Photos', false), tab('tabs-3', 'Audio', false)));

  // Boards ---------------------------------------------------------------------------------------
  lib.board('board-actions', 'Actions', { fill: '$surface' }, heading('Actions'),
    group('Buttons', show('button-filled'), show('button-tonal'), show('button-outlined'), show('button-text'), show('button-elevated'), show('button-icon')),
    group('Floating action and icon buttons', show('fab'), show('fab-extended'), show('icon-button'), show('icon-button-filled'), show('segmented')),
    group('Chips and badges', show('chip-assist'), show('chip-filter'), show('chip-filter-off'), show('badge')));
  lib.board('board-inputs', 'Inputs', { fill: '$surface' }, heading('Inputs'),
    tall('Text fields', show('text-field'), show('text-field-outlined'), show('search-bar')),
    group('Selection', show('checkbox'), show('checkbox-off'), show('radio'), show('radio-off'), show('switch'), show('switch-off')),
    group('Range', show('slider'), show('progress'), show('divider')));
  lib.board('board-containment', 'Containment and navigation', { fill: '$surface' }, heading('Containment and navigation'),
    tall('Cards', show('card-filled'), show('card-outlined'), show('card-elevated')),
    tall('Lists and menus', show('list-item'), show('menu')),
    tall('Dialogs', show('dialog'), show('snackbar')),
    tall('Bars', col({ gap: 16 }, show('top-app-bar'), show('tabs'), show('navigation-bar'))));

  // The overview a new design starts from: a phone screen (mail).
  const mails: [string, string, string, string][] = [['A', 'Ali Connors', 'Brunch this weekend? I’ll be in your neighborhood…', '10 min'], ['S', 'Sandra Adams', 'Summer BBQ: wish I could come, but I’m out of town…', '2 h'],
    ['T', 'Trevor Hansen', 'Oui oui: do you have Paris recommendations?', 'Mon'], ['B', 'Britta Holt', 'Birthday gift: have any ideas about what we should get…', 'Sun'], ['M', 'Mia Lopez', 'Recipe to try: I found a pasta recipe you will love…', 'Sat']];
  lib.board('overview', 'Overview', { width: 412, height: 915, padding: 0, gap: 0, clip: true, fill: '$surface' },
    row({ width: 'fill_container', height: 24, padding: [0, 24], alignItems: 'center', justifyContent: 'space_between' }, t('9:30', 'label'), row({ gap: 6 }, icon('wifi', { width: 16, height: 16, fill: '$on-surface' }), icon('battery-full', { width: 16, height: 16, fill: '$on-surface' }))),
    col({ width: 'fill_container', padding: [8, 16], gap: 12 },
      ref('search-bar', { id: 'overview-search', width: 'fill_container' }),
      row({ gap: 8 }, ref('chip-filter', { id: 'overview-chip-1' }, { 'chip-filter-label': { content: 'Inbox' } }), ref('chip-filter-off', { id: 'overview-chip-2' }, { 'chip-filter-off-label': { content: 'Unread' } }), ref('chip-filter-off', { id: 'overview-chip-3' }, { 'chip-filter-off-label': { content: 'Starred' } }))),
    col({ width: 'fill_container', height: 'fill_container' },
      ...mails.map(([l, who, what, when], i) => ref('list-item', { id: `overview-mail-${i + 1}`, width: 'fill_container' }, { 'list-item-avatar': { content: l }, 'list-item-headline': { content: who }, 'list-item-supporting': { content: what, width: 'fill_container', textGrowth: 'fixed-width' }, 'list-item-trailing': { content: when } }))),
    frame({ width: 'fill_container', height: 0, layout: 'none' },
      ref('fab-extended', { id: 'overview-fab', x: 220, y: -88 })),
    ref('navigation-bar', { id: 'overview-nav', width: 'fill_container' }));
  code(lib);
  return lib;
}

export const codeMeta = { library: 'Material Web', setup: 'npm install @material/web lucide-react (React 19 renders the md-* elements; declare them in JSX.IntrinsicElements for TypeScript)', inherited: ['font-sans'] };

/** Material 3 components as Material Web elements: https://material-web.dev. */
function code(lib: Library) {
  const side = (...modules: string[]) => Object.fromEntries(modules.map((m) => [`@material/web/${m}.js`, 'side-effect']));
  const buttons: [string, string, string][] = [['button-filled', 'md-filled-button', 'button/filled-button'], ['button-tonal', 'md-filled-tonal-button', 'button/filled-tonal-button'],
    ['button-outlined', 'md-outlined-button', 'button/outlined-button'], ['button-text', 'md-text-button', 'button/text-button'], ['button-elevated', 'md-elevated-button', 'button/elevated-button']];
  for (const [id, tag, mod] of buttons) lib.codeFor(id, `<${tag}{class}>{text:${id}-label}</${tag}>`, side(mod));
  lib.codeFor('button-icon', '<md-filled-button has-icon{class}>\n  <span slot="icon">{icon:button-icon-glyph}</span>\n  {text:button-icon-label}\n</md-filled-button>', side('button/filled-button'));
  lib.codeFor('fab', '<md-fab aria-label="{attr:fab-icon}"{class}>\n  <span slot="icon">{icon:fab-icon}</span>\n</md-fab>', side('fab/fab'));
  lib.codeFor('fab-extended', '<md-fab label="{attr:fab-extended-label}"{class}>\n  <span slot="icon">{icon:fab-extended-icon}</span>\n</md-fab>', side('fab/fab'));
  lib.codeFor('icon-button', '<md-icon-button aria-label="{attr:icon-button-glyph}"{class}>{icon:icon-button-glyph}</md-icon-button>', side('iconbutton/icon-button'));
  lib.codeFor('icon-button-filled', '<md-filled-icon-button aria-label="{attr:icon-button-filled-glyph}"{class}>{icon:icon-button-filled-glyph}</md-filled-icon-button>', side('iconbutton/filled-icon-button'));
  lib.codeFor('chip-assist', '<md-chip-set{class}>\n  <md-assist-chip label="{attr:chip-assist-label}"></md-assist-chip>\n</md-chip-set>', side('chips/chip-set', 'chips/assist-chip'));
  lib.codeFor('chip-filter', '<md-chip-set{class}>\n  <md-filter-chip label="{attr:chip-filter-label}" selected></md-filter-chip>\n</md-chip-set>', side('chips/chip-set', 'chips/filter-chip'));
  lib.codeFor('chip-filter-off', '<md-chip-set{class}>\n  <md-filter-chip label="{attr:chip-filter-off-label}"></md-filter-chip>\n</md-chip-set>', side('chips/chip-set', 'chips/filter-chip'));
  lib.codeFor('text-field', '<md-filled-text-field label="{attr:text-field-label}" value="{attr:text-field-value}"{class}></md-filled-text-field>', side('textfield/filled-text-field'));
  lib.codeFor('text-field-outlined', '<md-outlined-text-field label="{attr:text-field-outlined-label}" value="{attr:text-field-outlined-value}"{class}></md-outlined-text-field>', side('textfield/outlined-text-field'));
  for (const [id, on] of [['checkbox', ' checked'], ['checkbox-off', '']]) {
    lib.codeFor(id, `<label{class:flex items-center gap-3}>\n  <md-checkbox touch-target="wrapper"${on}></md-checkbox>\n  {text:${id}-label}\n</label>`, side('checkbox/checkbox'));
  }
  for (const [id, on] of [['radio', ' checked'], ['radio-off', '']]) {
    lib.codeFor(id, `<label{class:flex items-center gap-3}>\n  <md-radio name="option" value="{slug:${id}-label}"${on}></md-radio>\n  {text:${id}-label}\n</label>`, side('radio/radio'));
  }
  for (const [id, on] of [['switch', ' selected icons'], ['switch-off', '']]) {
    lib.codeFor(id, `<label{class:flex items-center gap-3}>\n  <md-switch${on}></md-switch>\n  {text:${id}-label}\n</label>`, side('switch/switch'));
  }
  lib.codeFor('slider', '<md-slider value="50"{class}></md-slider>', side('slider/slider'));
  lib.codeFor('progress', '<md-linear-progress value="0.6"{class}></md-linear-progress>', side('progress/linear-progress'));
  lib.codeFor('divider', '<md-divider{class}></md-divider>', side('divider/divider'));
  lib.codeFor('list-item', '<md-list-item{class}>\n  <div slot="headline">{text:list-item-headline}</div>\n  <div slot="supporting-text">{text:list-item-supporting}</div>\n  <div slot="trailing-supporting-text">{text:list-item-trailing}</div>\n</md-list-item>', side('list/list-item'));
  lib.codeFor('dialog', '<md-dialog open{class}>\n  <div slot="headline">{text:dialog-headline}</div>\n  <div slot="content">{text:dialog-text}</div>\n  <div slot="actions">\n    <md-text-button>{text:dialog-cancel/button-text-label}</md-text-button>\n    <md-text-button>{text:dialog-accept/button-text-label}</md-text-button>\n  </div>\n</md-dialog>', side('dialog/dialog', 'button/text-button'));
  lib.codeFor('tabs', '<md-tabs{class}>\n  <md-primary-tab>{text:tabs-1-label}</md-primary-tab>\n  <md-primary-tab>{text:tabs-2-label}</md-primary-tab>\n  <md-primary-tab>{text:tabs-3-label}</md-primary-tab>\n</md-tabs>', side('tabs/tabs', 'tabs/primary-tab'));
}
