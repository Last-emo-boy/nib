// nib's shadcn/ui library: shadcn/ui (MIT) components and its default neutral theme, drawn as .pen
// components. Sizes, radii, borders and shadows follow the components' Tailwind classes (shadcn v4).
import { col, ellipse, frame, icon, Library, oklch, rect, ref, row, show, text, themedColors, type N } from './kit.ts';

const L = (v: string) => oklch(v);
const light = {
  background: L('oklch(1 0 0)'), foreground: L('oklch(0.145 0 0)'),
  card: L('oklch(1 0 0)'), 'card-foreground': L('oklch(0.145 0 0)'),
  popover: L('oklch(1 0 0)'), 'popover-foreground': L('oklch(0.145 0 0)'),
  primary: L('oklch(0.205 0 0)'), 'primary-foreground': L('oklch(0.985 0 0)'),
  secondary: L('oklch(0.97 0 0)'), 'secondary-foreground': L('oklch(0.205 0 0)'),
  muted: L('oklch(0.97 0 0)'), 'muted-foreground': L('oklch(0.556 0 0)'),
  accent: L('oklch(0.97 0 0)'), 'accent-foreground': L('oklch(0.205 0 0)'),
  destructive: L('oklch(0.577 0.245 27.325)'), 'destructive-foreground': '#FFFFFF',
  border: L('oklch(0.922 0 0)'), input: L('oklch(0.922 0 0)'), ring: L('oklch(0.708 0 0)'),
  'chart-1': L('oklch(0.646 0.222 41.116)'), 'chart-2': L('oklch(0.6 0.118 184.704)'), 'chart-3': L('oklch(0.398 0.07 227.392)'),
  'chart-4': L('oklch(0.828 0.189 84.429)'), 'chart-5': L('oklch(0.769 0.188 70.08)'),
  sidebar: L('oklch(0.985 0 0)'), 'sidebar-foreground': L('oklch(0.145 0 0)'),
  'sidebar-primary': L('oklch(0.205 0 0)'), 'sidebar-primary-foreground': L('oklch(0.985 0 0)'),
  'sidebar-accent': L('oklch(0.97 0 0)'), 'sidebar-accent-foreground': L('oklch(0.205 0 0)'),
  'sidebar-border': L('oklch(0.922 0 0)'), 'sidebar-ring': L('oklch(0.708 0 0)'),
  // Not shadcn tokens: the fill of fields and the thumb of a switch, which differ between modes.
  'input-background': '#FFFFFF00', 'switch-thumb': L('oklch(1 0 0)'), 'primary-soft': L('oklch(0.205 0 0 / 20%)'),
  'muted-hover': L('oklch(0.97 0 0 / 50%)'),
};
const dark = {
  background: L('oklch(0.145 0 0)'), foreground: L('oklch(0.985 0 0)'),
  card: L('oklch(0.205 0 0)'), 'card-foreground': L('oklch(0.985 0 0)'),
  popover: L('oklch(0.205 0 0)'), 'popover-foreground': L('oklch(0.985 0 0)'),
  primary: L('oklch(0.922 0 0)'), 'primary-foreground': L('oklch(0.205 0 0)'),
  secondary: L('oklch(0.269 0 0)'), 'secondary-foreground': L('oklch(0.985 0 0)'),
  muted: L('oklch(0.269 0 0)'), 'muted-foreground': L('oklch(0.708 0 0)'),
  accent: L('oklch(0.269 0 0)'), 'accent-foreground': L('oklch(0.985 0 0)'),
  destructive: L('oklch(0.704 0.191 22.216)'), 'destructive-foreground': '#FFFFFF',
  border: L('oklch(1 0 0 / 10%)'), input: L('oklch(1 0 0 / 15%)'), ring: L('oklch(0.556 0 0)'),
  'chart-1': L('oklch(0.488 0.243 264.376)'), 'chart-2': L('oklch(0.696 0.17 162.48)'), 'chart-3': L('oklch(0.769 0.188 70.08)'),
  'chart-4': L('oklch(0.627 0.265 303.9)'), 'chart-5': L('oklch(0.645 0.246 16.439)'),
  sidebar: L('oklch(0.205 0 0)'), 'sidebar-foreground': L('oklch(0.985 0 0)'),
  'sidebar-primary': L('oklch(0.488 0.243 264.376)'), 'sidebar-primary-foreground': L('oklch(0.985 0 0)'),
  'sidebar-accent': L('oklch(0.269 0 0)'), 'sidebar-accent-foreground': L('oklch(0.985 0 0)'),
  'sidebar-border': L('oklch(1 0 0 / 10%)'), 'sidebar-ring': L('oklch(0.556 0 0)'),
  'input-background': L('oklch(1 0 0 / 4.5%)'), 'switch-thumb': L('oklch(0.985 0 0)'), 'primary-soft': L('oklch(0.922 0 0 / 20%)'),
  'muted-hover': L('oklch(0.269 0 0 / 50%)'),
};

const shadow = {
  xs: { type: 'shadow', offset: { x: 0, y: 1 }, blur: 2, color: '#0000000D' },
  sm: [{ type: 'shadow', offset: { x: 0, y: 1 }, blur: 3, color: '#0000001A' }, { type: 'shadow', offset: { x: 0, y: 1 }, blur: 2, spread: -1, color: '#0000001A' }],
  md: [{ type: 'shadow', offset: { x: 0, y: 4 }, blur: 6, spread: -1, color: '#0000001A' }, { type: 'shadow', offset: { x: 0, y: 2 }, blur: 4, spread: -2, color: '#0000001A' }],
  lg: [{ type: 'shadow', offset: { x: 0, y: 10 }, blur: 15, spread: -3, color: '#0000001A' }, { type: 'shadow', offset: { x: 0, y: 4 }, blur: 6, spread: -4, color: '#0000001A' }],
};

const font = '$font-sans';
const t = (content: string, props: N = {}) => text(content, { fontFamily: font, fontSize: 14, fill: '$foreground', lineHeight: 1.43, ...props });
const muted = (content: string, props: N = {}) => t(content, { fill: '$muted-foreground', ...props });
const heading = (content: string) => t(content, { fontSize: 24, fontWeight: '600', lineHeight: 1.2 });
const caption = (content: string) => muted(content, { fontSize: 13 });
/** A labelled row of examples on a board. */
const group = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 16, alignItems: 'center' }, ...items));
/** The same, for tall components, which line up at the top. */
const tall = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 24, alignItems: 'start' }, ...items));

export const meta = {
  id: 'shadcn',
  name: 'shadcn/ui',
  summary: {
    en: 'Neutral, compact components from shadcn/ui: buttons, forms, menus, cards, tables and a dashboard to start from.',
    zh: 'shadcn/ui 的中性、紧凑组件：按钮、表单、菜单、卡片、表格，以及一个可直接起步的仪表盘。',
  },
  basedOn: 'shadcn/ui (new-york, neutral theme)',
  license: 'MIT',
  homepage: 'https://ui.shadcn.com',
  /** Which variables follow a brand's color, radius and font (see the daemon's brand.ts). */
  brand: { anchor: 'primary', radius: 'radius', font: 'font-sans', vars: { 'primary-foreground': 'on', ring: 'brand/60', 'primary-soft': 'brand/20', 'sidebar-primary': 'brand', 'sidebar-primary-foreground': 'on', 'sidebar-ring': 'brand/60', 'chart-1': 'brand' } },
};

export function shadcn(): Library {
  const lib = new Library('shadcn', { Mode: ['Light', 'Dark'] });
  Object.assign(lib.variables, themedColors(light, dark), {
    'font-sans': { type: 'string', value: 'Geist' },
    'font-mono': { type: 'string', value: 'Geist Mono' },
    radius: { type: 'number', value: 10 },
    'radius-sm': { type: 'number', value: 6 }, 'radius-md': { type: 'number', value: 8 },
    'radius-lg': { type: 'number', value: 10 }, 'radius-xl': { type: 'number', value: 14 },
  });

  // Buttons --------------------------------------------------------------------------------------
  const button = (id: string, name: string, look: N, label: N, size: 'sm' | 'default' | 'lg' = 'default') => lib.component(id, name, row({
    height: size === 'sm' ? 32 : size === 'lg' ? 40 : 36, padding: [0, size === 'sm' ? 12 : size === 'lg' ? 24 : 16],
    gap: size === 'sm' ? 6 : 8, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-md', ...look,
  }, text('Button', { id: `${id}-label`, fontFamily: font, fontSize: 14, fontWeight: '500', lineHeight: 1.43, ...label })));
  button('button', 'Button / Default', { fill: '$primary', effect: shadow.xs }, { fill: '$primary-foreground' });
  button('button-secondary', 'Button / Secondary', { fill: '$secondary', effect: shadow.xs }, { fill: '$secondary-foreground' });
  button('button-outline', 'Button / Outline', { fill: '$input-background', stroke: '$border', strokeWidth: 1, effect: shadow.xs }, { fill: '$foreground' });
  button('button-ghost', 'Button / Ghost', {}, { fill: '$foreground' });
  button('button-destructive', 'Button / Destructive', { fill: '$destructive', effect: shadow.xs }, { fill: '$destructive-foreground' });
  button('button-link', 'Button / Link', {}, { fill: '$primary', underline: true });
  button('button-sm', 'Button / Small', { fill: '$primary', effect: shadow.xs }, { fill: '$primary-foreground', fontSize: 13 }, 'sm');
  button('button-lg', 'Button / Large', { fill: '$primary', effect: shadow.xs }, { fill: '$primary-foreground' }, 'lg');
  lib.component('button-icon', 'Button / Icon', row({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-md', fill: '$input-background', stroke: '$border', strokeWidth: 1, effect: shadow.xs },
    icon('chevron-right', { id: 'button-icon-glyph', fill: '$foreground' })));
  lib.component('button-with-icon', 'Button / With Icon', row({ height: 36, padding: [0, 16, 0, 12], gap: 8, alignItems: 'center', cornerRadius: '$radius-md', fill: '$primary', effect: shadow.xs },
    icon('mail', { id: 'button-with-icon-glyph', fill: '$primary-foreground' }),
    text('Login with Email', { id: 'button-with-icon-label', fontFamily: font, fontSize: 14, fontWeight: '500', fill: '$primary-foreground' })));

  // Form controls --------------------------------------------------------------------------------
  const field = { height: 36, padding: [4, 12], alignItems: 'center', cornerRadius: '$radius-md', stroke: '$input', strokeWidth: 1, fill: '$input-background', effect: shadow.xs };
  lib.component('label', 'Label', row({ alignItems: 'center', gap: 8 }, t('Label', { id: 'label-text', fontWeight: '500', lineHeight: 1 })));
  lib.component('input', 'Input', row({ ...field, width: 280 }, muted('Email', { id: 'input-text', width: 'fill_container' })));
  lib.component('input-filled', 'Input / Filled', row({ ...field, width: 280 }, t('m@example.com', { id: 'input-filled-text', width: 'fill_container' })));
  lib.component('input-icon', 'Input / With Icon', row({ ...field, width: 280, gap: 8 }, icon('search', { fill: '$muted-foreground' }), muted('Search…', { id: 'input-icon-text', width: 'fill_container' })));
  lib.component('textarea', 'Textarea', row({ ...field, height: 80, width: 280, alignItems: 'start', padding: [8, 12] }, muted('Type your message here.', { id: 'textarea-text', width: 'fill_container', textGrowth: 'fixed-width' })));
  lib.component('select', 'Select', row({ ...field, width: 180, justifyContent: 'space_between', gap: 8 }, muted('Select a fruit', { id: 'select-text' }), icon('chevron-down', { fill: '$muted-foreground', opacity: 0.5 })));
  lib.component('field', 'Field', col({ gap: 8, width: 280 },
    ref('label', { id: 'field-label' }, { 'label-text': { content: 'Email' } }),
    ref('input', { id: 'field-input', width: 'fill_container' }, { 'input-text': { content: 'm@example.com' } }),
    muted('Enter your email address.', { id: 'field-description', fontSize: 13 })));

  const box = (checked: boolean): N => frame({ width: 16, height: 16, cornerRadius: 4, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', effect: shadow.xs,
    ...(checked ? { fill: '$primary', stroke: '$primary', strokeWidth: 1 } : { fill: '$input-background', stroke: '$input', strokeWidth: 1 }) },
  ...(checked ? [icon('check', { width: 14, height: 14, fill: '$primary-foreground' })] : []));
  lib.component('checkbox', 'Checkbox / Checked', row({ gap: 8, alignItems: 'center' }, box(true), t('Accept terms and conditions', { id: 'checkbox-label', fontWeight: '500', lineHeight: 1 })));
  lib.component('checkbox-off', 'Checkbox / Unchecked', row({ gap: 8, alignItems: 'center' }, box(false), t('Remember me', { id: 'checkbox-off-label', fontWeight: '500', lineHeight: 1 })));
  const radio = (on: boolean): N => frame({ width: 16, height: 16, cornerRadius: 8, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', stroke: on ? '$primary' : '$input', strokeWidth: 1, fill: '$input-background', effect: shadow.xs },
    ...(on ? [ellipse({ width: 8, height: 8, fill: '$primary' })] : []));
  lib.component('radio', 'Radio / Selected', row({ gap: 8, alignItems: 'center' }, radio(true), t('Default', { id: 'radio-label', lineHeight: 1 })));
  lib.component('radio-off', 'Radio / Unselected', row({ gap: 8, alignItems: 'center' }, radio(false), t('Compact', { id: 'radio-off-label', lineHeight: 1 })));
  const sw = (on: boolean): N => frame({ width: 32, height: 18, cornerRadius: 9, layout: 'horizontal', alignItems: 'center', justifyContent: on ? 'end' : 'start', padding: 1, fill: on ? '$primary' : '$input', effect: shadow.xs },
    ellipse({ width: 16, height: 16, fill: on ? '$primary-foreground' : '$switch-thumb' }));
  lib.component('switch', 'Switch / On', row({ gap: 8, alignItems: 'center' }, sw(true), t('Airplane Mode', { id: 'switch-label', fontWeight: '500', lineHeight: 1 })));
  lib.component('switch-off', 'Switch / Off', row({ gap: 8, alignItems: 'center' }, sw(false), t('Notifications', { id: 'switch-off-label', fontWeight: '500', lineHeight: 1 })));
  lib.component('slider', 'Slider', frame({ width: 240, height: 16, layout: 'none' },
    rect({ x: 0, y: 5, width: 240, height: 6, cornerRadius: 3, fill: '$muted' }),
    rect({ id: 'slider-range', x: 0, y: 5, width: 120, height: 6, cornerRadius: 3, fill: '$primary' }),
    ellipse({ id: 'slider-thumb', x: 112, y: 0, width: 16, height: 16, fill: '$background', stroke: '$primary', strokeWidth: 1, effect: shadow.sm })));
  lib.component('toggle', 'Toggle / On', row({ height: 36, padding: [0, 8], gap: 8, alignItems: 'center', cornerRadius: '$radius-md', fill: '$accent' }, icon('bold', { id: 'toggle-icon', fill: '$accent-foreground' })));
  lib.component('toggle-off', 'Toggle / Off', row({ height: 36, padding: [0, 8], gap: 8, alignItems: 'center', cornerRadius: '$radius-md' }, icon('italic', { id: 'toggle-off-icon', fill: '$foreground' })));
  lib.component('toggle-group', 'Toggle Group', row({ cornerRadius: '$radius-md', stroke: '$input', strokeWidth: 1, effect: shadow.xs, clip: true },
    row({ height: 36, padding: [0, 10], alignItems: 'center', fill: '$accent' }, icon('align-left', { fill: '$accent-foreground' })),
    row({ height: 36, padding: [0, 10], alignItems: 'center', stroke: '$input', strokeWidth: { left: 1 } }, icon('align-center', { fill: '$foreground' })),
    row({ height: 36, padding: [0, 10], alignItems: 'center', stroke: '$input', strokeWidth: { left: 1 } }, icon('align-right', { fill: '$foreground' }))));

  // Display --------------------------------------------------------------------------------------
  const badge = (id: string, name: string, look: N, fill: string) => lib.component(id, name, row({ padding: [2, 8], gap: 4, alignItems: 'center', cornerRadius: '$radius-md', ...look },
    text('Badge', { id: `${id}-label`, fontFamily: font, fontSize: 12, fontWeight: '500', lineHeight: 1.33, fill })));
  badge('badge', 'Badge / Default', { fill: '$primary' }, '$primary-foreground');
  badge('badge-secondary', 'Badge / Secondary', { fill: '$secondary' }, '$secondary-foreground');
  badge('badge-outline', 'Badge / Outline', { stroke: '$border', strokeWidth: 1 }, '$foreground');
  badge('badge-destructive', 'Badge / Destructive', { fill: '$destructive' }, '$destructive-foreground');
  lib.component('avatar', 'Avatar', row({ width: 32, height: 32, cornerRadius: 16, alignItems: 'center', justifyContent: 'center', fill: '$muted', clip: true },
    t('CN', { id: 'avatar-initials', fontSize: 13, fontWeight: '500' })));
  lib.component('avatar-group', 'Avatar Group', row({ gap: -8 },
    ...['CN', 'LR', 'ER'].map((c, i) => ref('avatar', { id: `avatar-group-${i + 1}`, stroke: '$background', strokeWidth: 2, strokeAlignment: 'outer' }, { 'avatar-initials': { content: c } }))));
  lib.component('separator', 'Separator', rect({ width: 240, height: 1, fill: '$border' }));
  lib.component('skeleton', 'Skeleton', row({ gap: 16, alignItems: 'center', width: 260 },
    ellipse({ width: 48, height: 48, fill: '$accent' }),
    col({ gap: 8, width: 'fill_container' }, rect({ width: 'fill_container', height: 16, cornerRadius: '$radius-md', fill: '$accent' }), rect({ width: 150, height: 16, cornerRadius: '$radius-md', fill: '$accent' }))));
  lib.component('progress', 'Progress', frame({ width: 240, height: 8, cornerRadius: 4, fill: '$primary-soft', layout: 'none', clip: true },
    rect({ id: 'progress-value', x: 0, y: 0, width: 144, height: 8, fill: '$primary' })));
  lib.component('tooltip', 'Tooltip', row({ padding: [6, 12], cornerRadius: '$radius-md', fill: '$primary' },
    text('Add to library', { id: 'tooltip-text', fontFamily: font, fontSize: 12, fill: '$primary-foreground', lineHeight: 1.33 })));
  lib.component('kbd', 'Kbd', row({ height: 20, padding: [0, 4], cornerRadius: 4, fill: '$muted', alignItems: 'center', justifyContent: 'center' },
    text('⌘K', { id: 'kbd-text', fontFamily: font, fontSize: 12, fontWeight: '500', fill: '$muted-foreground' })));
  lib.component('alert', 'Alert / Default', row({ width: 400, padding: [12, 16], gap: 12, cornerRadius: '$radius-lg', stroke: '$border', strokeWidth: 1, fill: '$card' },
    icon('circle-check', { fill: '$card-foreground', id: 'alert-icon' }),
    col({ gap: 2, width: 'fill_container' }, t('Success! Your changes have been saved', { id: 'alert-title', fontWeight: '500', fill: '$card-foreground' }),
      muted('This is an alert with icon, title and description.', { id: 'alert-description', width: 'fill_container', textGrowth: 'fixed-width' }))));
  lib.component('alert-destructive', 'Alert / Destructive', row({ width: 400, padding: [12, 16], gap: 12, cornerRadius: '$radius-lg', stroke: '$border', strokeWidth: 1, fill: '$card' },
    icon('circle-alert', { fill: '$destructive', id: 'alert-destructive-icon' }),
    col({ gap: 2, width: 'fill_container' }, t('Unable to process your payment.', { id: 'alert-destructive-title', fontWeight: '500', fill: '$destructive' }),
      t('Please verify your billing information and try again.', { id: 'alert-destructive-description', width: 'fill_container', textGrowth: 'fixed-width', fill: '$destructive', opacity: 0.9 }))));

  // Card -----------------------------------------------------------------------------------------
  lib.component('card', 'Card', col({ width: 360, padding: [24, 0], gap: 24, cornerRadius: '$radius-xl', stroke: '$border', strokeWidth: 1, fill: '$card', effect: shadow.sm },
    col({ id: 'card-header', padding: [0, 24], gap: 6, width: 'fill_container' },
      t('Card Title', { id: 'card-title', fontWeight: '600', lineHeight: 1, fill: '$card-foreground' }),
      muted('Card Description', { id: 'card-description', width: 'fill_container', textGrowth: 'fixed-width' })),
    col({ id: 'card-content', padding: [0, 24], gap: 16, width: 'fill_container' },
      muted('Card Content', { fill: '$card-foreground' })),
    row({ id: 'card-footer', padding: [0, 24], gap: 8, alignItems: 'center', width: 'fill_container' },
      ref('button', { id: 'card-action', width: 'fill_container' }, { 'button-label': { content: 'Action' } }))));

  // Navigation -----------------------------------------------------------------------------------
  const trigger = (label: string, active: boolean, id?: string): N => row({ ...(id ? { id } : {}), height: 29, padding: [4, 8], alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-md', width: 'fill_container',
    ...(active ? { fill: '$background', effect: shadow.sm } : {}) }, t(label, { ...(id ? { id: `${id}-label` } : {}), fontWeight: '500', fill: active ? '$foreground' : '$muted-foreground' }));
  lib.component('tabs', 'Tabs', row({ height: 36, padding: 3, cornerRadius: '$radius-lg', fill: '$muted', width: 320, alignItems: 'center' },
    trigger('Account', true, 'tabs-1'), trigger('Password', false, 'tabs-2'), trigger('Billing', false, 'tabs-3')));
  const chevron = () => icon('chevron-right', { width: 14, height: 14, fill: '$muted-foreground' });
  lib.component('breadcrumb', 'Breadcrumb', row({ gap: 10, alignItems: 'center' }, muted('Home', { id: 'breadcrumb-1' }), chevron(), muted('Components', { id: 'breadcrumb-2' }), chevron(), t('Breadcrumb', { id: 'breadcrumb-page' })));
  const page = (n: string, active = false): N => row({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-md', ...(active ? { stroke: '$border', strokeWidth: 1, fill: '$background', effect: shadow.xs } : {}) }, t(n, { fontWeight: '500' }));
  lib.component('pagination', 'Pagination', row({ gap: 4, alignItems: 'center' },
    row({ height: 36, padding: [0, 10], gap: 4, alignItems: 'center', cornerRadius: '$radius-md' }, icon('chevron-left', { fill: '$foreground' }), t('Previous', { fontWeight: '500' })),
    page('1'), page('2', true), page('3'),
    row({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }, icon('ellipsis', { fill: '$foreground' })),
    row({ height: 36, padding: [0, 10], gap: 4, alignItems: 'center', cornerRadius: '$radius-md' }, t('Next', { fontWeight: '500' }), icon('chevron-right', { fill: '$foreground' }))));
  const menuItem = (glyph: string, label: string, shortcut?: string, active = false): N => row({ height: 32, padding: [6, 8], gap: 8, alignItems: 'center', cornerRadius: 4, width: 'fill_container', ...(active ? { fill: '$accent' } : {}) },
    icon(glyph, { fill: '$muted-foreground' }), t(label, { width: 'fill_container', fill: active ? '$accent-foreground' : '$popover-foreground' }),
    ...(shortcut ? [muted(shortcut, { fontSize: 12, letterSpacing: 1 })] : []));
  const menuSep = () => rect({ width: 'fill_container', height: 1, fill: '$border' });
  lib.component('dropdown-menu', 'Dropdown Menu', col({ width: 224, padding: 4, gap: 0, cornerRadius: '$radius-md', stroke: '$border', strokeWidth: 1, fill: '$popover', effect: shadow.md },
    row({ height: 32, padding: [6, 8], alignItems: 'center' }, t('My Account', { fontWeight: '500', fill: '$popover-foreground' })),
    menuSep(), menuItem('user', 'Profile', '⇧⌘P', true), menuItem('credit-card', 'Billing', '⌘B'), menuItem('settings', 'Settings', '⌘S'), menuItem('keyboard', 'Keyboard shortcuts', '⌘K'),
    menuSep(), menuItem('users', 'Team'), menuItem('plus', 'New Team', '⌘+T'),
    menuSep(), menuItem('log-out', 'Log out', '⇧⌘Q')));
  lib.component('command', 'Command', col({ width: 400, cornerRadius: '$radius-lg', stroke: '$border', strokeWidth: 1, fill: '$popover', effect: shadow.md, clip: true },
    row({ height: 44, padding: [0, 12], gap: 8, alignItems: 'center', width: 'fill_container', stroke: '$border', strokeWidth: { bottom: 1 } }, icon('search', { fill: '$muted-foreground', opacity: 0.5 }), muted('Type a command or search…', { id: 'command-placeholder' })),
    col({ padding: 4, width: 'fill_container' },
      row({ padding: [6, 8] }, muted('Suggestions', { fontSize: 12, fontWeight: '500' })),
      menuItem('calendar', 'Calendar', undefined, true), menuItem('smile', 'Search Emoji'), menuItem('calculator', 'Calculator')),
    menuSep(),
    col({ padding: 4, width: 'fill_container' },
      row({ padding: [6, 8] }, muted('Settings', { fontSize: 12, fontWeight: '500' })),
      menuItem('user', 'Profile', '⌘P'), menuItem('credit-card', 'Billing', '⌘B'), menuItem('settings', 'Settings', '⌘S'))));
  const navItem = (glyph: string, label: string, active = false): N => row({ height: 32, padding: 8, gap: 8, alignItems: 'center', cornerRadius: '$radius-md', width: 'fill_container', ...(active ? { fill: '$sidebar-accent' } : {}) },
    icon(glyph, { fill: active ? '$sidebar-accent-foreground' : '$sidebar-foreground' }), t(label, { fill: active ? '$sidebar-accent-foreground' : '$sidebar-foreground', fontWeight: active ? '500' : '400' }));
  lib.component('sidebar', 'Sidebar', col({ width: 256, height: 640, fill: '$sidebar', stroke: '$sidebar-border', strokeWidth: { right: 1 }, padding: 8, gap: 8 },
    row({ padding: 8, gap: 8, alignItems: 'center', width: 'fill_container' },
      row({ width: 32, height: 32, cornerRadius: '$radius-lg', fill: '$sidebar-primary', alignItems: 'center', justifyContent: 'center' }, icon('gallery-vertical-end', { fill: '$sidebar-primary-foreground' })),
      col({ gap: 2, width: 'fill_container' }, t('Acme Inc', { id: 'sidebar-team', fontWeight: '600', fill: '$sidebar-foreground', lineHeight: 1.1 }), muted('Enterprise', { fontSize: 12, lineHeight: 1.1 })),
      icon('chevrons-up-down', { fill: '$sidebar-foreground', opacity: 0.6 })),
    col({ gap: 2, width: 'fill_container' },
      row({ height: 32, padding: [0, 8], alignItems: 'center' }, t('Platform', { fontSize: 12, fontWeight: '500', fill: '$sidebar-foreground', opacity: 0.7 })),
      navItem('square-terminal', 'Playground', true), navItem('bot', 'Models'), navItem('book-open', 'Documentation'), navItem('settings-2', 'Settings')),
    col({ gap: 2, width: 'fill_container' },
      row({ height: 32, padding: [0, 8], alignItems: 'center' }, t('Projects', { fontSize: 12, fontWeight: '500', fill: '$sidebar-foreground', opacity: 0.7 })),
      navItem('frame', 'Design Engineering'), navItem('chart-pie', 'Sales & Marketing'), navItem('map', 'Travel')),
    frame({ height: 'fill_container', width: 'fill_container' }),
    row({ padding: 8, gap: 8, alignItems: 'center', width: 'fill_container' },
      ref('avatar', { id: 'sidebar-avatar', cornerRadius: '$radius-lg' }),
      col({ gap: 2, width: 'fill_container' }, t('shadcn', { fontWeight: '600', fill: '$sidebar-foreground', lineHeight: 1.1 }), muted('m@example.com', { fontSize: 12, lineHeight: 1.1 })),
      icon('chevrons-up-down', { fill: '$sidebar-foreground', opacity: 0.6 }))));
  const accordionItem = (title: string, body?: string): N => col({ width: 'fill_container', stroke: '$border', strokeWidth: { bottom: 1 } },
    row({ padding: [16, 0], alignItems: 'center', justifyContent: 'space_between', width: 'fill_container' }, t(title, { fontWeight: '500' }), icon(body ? 'chevron-up' : 'chevron-down', { fill: '$muted-foreground' })),
    ...(body ? [col({ padding: [0, 0, 16, 0], width: 'fill_container' }, t(body, { width: 'fill_container', textGrowth: 'fixed-width' }))] : []));
  lib.component('accordion', 'Accordion', col({ width: 400 },
    accordionItem('Product Information', 'Our flagship product combines cutting-edge technology with sleek design. Built with premium materials, it offers unparalleled performance and reliability.'),
    accordionItem('Shipping Details'), accordionItem('Return Policy')));

  // Overlays -------------------------------------------------------------------------------------
  lib.component('dialog', 'Dialog', col({ width: 448, padding: 24, gap: 16, cornerRadius: '$radius-lg', stroke: '$border', strokeWidth: 1, fill: '$background', effect: shadow.lg },
    row({ width: 'fill_container', alignItems: 'start', gap: 16 },
      col({ gap: 8, width: 'fill_container' }, t('Edit profile', { id: 'dialog-title', fontSize: 18, fontWeight: '600', lineHeight: 1 }),
        muted("Make changes to your profile here. Click save when you're done.", { id: 'dialog-description', width: 'fill_container', textGrowth: 'fixed-width' })),
      icon('x', { fill: '$foreground', opacity: 0.7 })),
    col({ id: 'dialog-body', gap: 16, width: 'fill_container' },
      ref('field', { id: 'dialog-name', width: 'fill_container' }, { 'field-label/label-text': { content: 'Name' }, 'field-input/input-text': { content: 'Pedro Duarte', fill: '$foreground' }, 'field-description': { enabled: false } }),
      ref('field', { id: 'dialog-username', width: 'fill_container' }, { 'field-label/label-text': { content: 'Username' }, 'field-input/input-text': { content: '@peduarte', fill: '$foreground' }, 'field-description': { enabled: false } })),
    row({ gap: 8, justifyContent: 'end', width: 'fill_container' },
      ref('button-outline', { id: 'dialog-cancel' }, { 'button-outline-label': { content: 'Cancel' } }),
      ref('button', { id: 'dialog-save' }, { 'button-label': { content: 'Save changes' } }))));
  lib.component('popover', 'Popover', col({ width: 288, padding: 16, gap: 16, cornerRadius: '$radius-md', stroke: '$border', strokeWidth: 1, fill: '$popover', effect: shadow.md },
    col({ gap: 8 }, t('Dimensions', { fontWeight: '500', lineHeight: 1 }), muted('Set the dimensions for the layer.')),
    ...[['Width', '100%'], ['Max. width', '300px'], ['Height', '25px']].map(([k, v]) => row({ gap: 16, alignItems: 'center', width: 'fill_container' },
      t(k, { width: 80, fontWeight: '500' }), row({ ...field, height: 32, width: 'fill_container' }, t(v))))));
  lib.component('toast', 'Toast', row({ width: 356, padding: 16, gap: 12, alignItems: 'center', cornerRadius: '$radius-lg', stroke: '$border', strokeWidth: 1, fill: '$popover', effect: shadow.lg },
    col({ gap: 2, width: 'fill_container' }, t('Event has been created', { id: 'toast-title', fontWeight: '500', fill: '$popover-foreground' }), muted('Sunday, December 03, 2023 at 9:00 AM', { id: 'toast-description', fontSize: 13 })),
    ref('button-sm', { id: 'toast-action' }, { 'button-sm-label': { content: 'Undo' } })));

  // Data -----------------------------------------------------------------------------------------
  const invoices: [string, string, string, string][] = [['INV001', 'Paid', 'Credit Card', '$250.00'], ['INV002', 'Pending', 'PayPal', '$150.00'], ['INV003', 'Unpaid', 'Bank Transfer', '$350.00'], ['INV004', 'Paid', 'Credit Card', '$450.00'], ['INV005', 'Paid', 'PayPal', '$550.00']];
  const cell = (s: string, { text: style, ...props }: N = {}): N => row({ padding: 8, height: 'fill_container', alignItems: 'center', width: 'fill_container', ...props }, t(s, style as N));
  lib.component('table', 'Table', col({ width: 560 },
    row({ height: 40, width: 'fill_container', stroke: '$border', strokeWidth: { bottom: 1 } },
      ...['Invoice', 'Status', 'Method'].map((h) => cell(h, { text: { fontWeight: '500' } })), cell('Amount', { justifyContent: 'end', text: { fontWeight: '500' } })),
    ...invoices.map(([inv, status, method, amount], i) => row({ height: 49, width: 'fill_container', stroke: '$border', strokeWidth: { bottom: i === invoices.length - 1 ? 0 : 1 } },
      cell(inv, { text: { fontWeight: '500' } }),
      row({ padding: 8, height: 'fill_container', alignItems: 'center', width: 'fill_container' }, ref(status === 'Paid' ? 'badge-secondary' : status === 'Pending' ? 'badge-outline' : 'badge-destructive', {}, { [status === 'Paid' ? 'badge-secondary-label' : status === 'Pending' ? 'badge-outline-label' : 'badge-destructive-label']: { content: status } })),
      cell(method), cell(amount, { justifyContent: 'end' }))),
    row({ height: 48, width: 'fill_container', fill: '$muted-hover', stroke: '$border', strokeWidth: { top: 1 } }, cell('Total', { text: { fontWeight: '500' } }), cell(''), cell(''), cell('$2,500.00', { justifyContent: 'end', text: { fontWeight: '500' } }))));
  const day = (n: number, look: 'selected' | 'today' | 'outside' | 'normal' = 'normal'): N => row({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-md',
    ...(look === 'selected' ? { fill: '$primary' } : look === 'today' ? { fill: '$accent' } : {}) },
  t(String(n), { fill: look === 'selected' ? '$primary-foreground' : look === 'outside' ? '$muted-foreground' : look === 'today' ? '$accent-foreground' : '$foreground' }));
  // June 2025 starts on a Sunday.
  const weeks: N[] = [];
  for (let w = 0; w < 5; w++) weeks.push(row({ gap: 0 }, ...Array.from({ length: 7 }, (_, d) => {
    const n = w * 7 + d + 1;
    return n > 30 ? day(n - 30, 'outside') : day(n, n === 12 ? 'selected' : n === 9 ? 'today' : 'normal');
  })));
  lib.component('calendar', 'Calendar', col({ padding: 12, gap: 16, cornerRadius: '$radius-lg', stroke: '$border', strokeWidth: 1, fill: '$background', effect: shadow.sm },
    row({ width: 224, alignItems: 'center', justifyContent: 'space_between' },
      row({ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-md' }, icon('chevron-left', { fill: '$foreground' })),
      t('June 2025', { id: 'calendar-month', fontWeight: '500' }),
      row({ width: 28, height: 28, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-md' }, icon('chevron-right', { fill: '$foreground' }))),
    col({ gap: 8 },
      row({}, ...['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => row({ width: 32, justifyContent: 'center' }, muted(d, { fontSize: 12.8 })))),
      ...weeks)));
  lib.component('stat-card', 'Stat Card', col({ width: 260, padding: 24, gap: 8, cornerRadius: '$radius-xl', stroke: '$border', strokeWidth: 1, fill: '$card', effect: shadow.sm },
    row({ width: 'fill_container', justifyContent: 'space_between', alignItems: 'center' }, muted('Total Revenue', { id: 'stat-card-label' }), ref('badge-outline', { id: 'stat-card-trend' }, { 'badge-outline-label': { content: '+12.5%' } })),
    t('$1,250.00', { id: 'stat-card-value', fontSize: 30, fontWeight: '600', lineHeight: 1.2, fill: '$card-foreground' }),
    muted('Trending up this month', { id: 'stat-card-note', fontSize: 13 })));
  const bars = [48, 72, 56, 88, 64, 96, 80, 60, 74, 92, 68, 84];
  lib.component('chart-card', 'Chart Card', col({ width: 560, padding: [24, 0], gap: 24, cornerRadius: '$radius-xl', stroke: '$border', strokeWidth: 1, fill: '$card', effect: shadow.sm },
    col({ padding: [0, 24], gap: 6 }, t('Bar Chart', { id: 'chart-card-title', fontWeight: '600', lineHeight: 1 }), muted('January - June 2025', { id: 'chart-card-description' })),
    row({ padding: [0, 24], height: 180, gap: 24, alignItems: 'end', width: 'fill_container' },
      // Desktop and mobile visitors, January to June.
      ...[0, 2, 4, 6, 8, 10].map((i) => row({ width: 'fill_container', height: 'fill_container', gap: 4, alignItems: 'end' },
        rect({ width: 'fill_container', height: (bars[i] / 100) * 180, cornerRadius: [4, 4, 0, 0], fill: '$chart-1' }),
        rect({ width: 'fill_container', height: (bars[i + 1] / 100) * 180, cornerRadius: [4, 4, 0, 0], fill: '$chart-2' })))),
    row({ padding: [0, 24], gap: 8, alignItems: 'center' }, t('Trending up by 5.2% this month', { fontWeight: '500' }), icon('trending-up', { fill: '$foreground' }))));

  // Boards ---------------------------------------------------------------------------------------
  lib.board('board-buttons', 'Buttons', {}, heading('Buttons'),
    group('Variants', show('button'), show('button-secondary'), show('button-outline'), show('button-ghost'), show('button-destructive'), show('button-link')),
    group('Sizes and icons', show('button-sm'), show('button-lg'), show('button-icon'), show('button-with-icon')),
    group('Toggles', show('toggle'), show('toggle-off'), show('toggle-group')));
  lib.board('board-forms', 'Forms', {}, heading('Forms'),
    tall('Fields', show('label'), show('input'), show('input-filled'), show('input-icon')),
    tall('More fields', show('textarea'), show('select'), show('field')),
    group('Choices', show('checkbox'), show('checkbox-off'), show('radio'), show('radio-off'), show('switch'), show('switch-off')),
    group('Range', show('slider')));
  lib.board('board-display', 'Display', {}, heading('Display'),
    group('Badges', show('badge'), show('badge-secondary'), show('badge-outline'), show('badge-destructive'), show('kbd'), show('tooltip')),
    group('Avatars and placeholders', show('avatar'), show('avatar-group'), show('skeleton'), show('progress'), show('separator')),
    tall('Alerts', show('alert'), show('alert-destructive')),
    tall('Cards', show('card'), show('stat-card')));
  lib.board('board-navigation', 'Navigation', {}, heading('Navigation'),
    group('Tabs, breadcrumb and pagination', show('tabs'), show('breadcrumb')),
    group('Pages', show('pagination')),
    tall('Menus', show('dropdown-menu'), show('command')),
    tall('Sidebar and accordion', show('sidebar'), show('accordion')));
  lib.board('board-overlays', 'Overlays and data', {}, heading('Overlays and data'),
    tall('Dialogs', show('dialog'), show('popover')),
    group('Notifications', show('toast')),
    tall('Data', show('table'), show('calendar')),
    group('Charts', show('chart-card')));

  // The overview a new design starts from, and the dashboard's preview.
  lib.board('overview', 'Overview', { width: 1440, height: 900, padding: 0, gap: 0, layout: 'horizontal', clip: true },
    ref('sidebar', { id: 'overview-sidebar', height: 'fill_container' }),
    col({ width: 'fill_container', height: 'fill_container', padding: 32, gap: 24 },
      row({ width: 'fill_container', alignItems: 'center', justifyContent: 'space_between' },
        col({ gap: 4 }, t('Dashboard', { fontSize: 24, fontWeight: '600', lineHeight: 1.2 }), muted('Overview of your account this month.')),
        row({ gap: 8 }, ref('input-icon', { id: 'overview-search', width: 240 }), ref('button-with-icon', { id: 'overview-new' }, { 'button-with-icon-glyph': { icon: 'plus' }, 'button-with-icon-label': { content: 'New report' } }))),
      ref('tabs', { id: 'overview-tabs', width: 360 }, { 'tabs-1-label': { content: 'Overview' }, 'tabs-2-label': { content: 'Analytics' }, 'tabs-3-label': { content: 'Reports' } }),
      row({ width: 'fill_container', gap: 16 },
        ref('stat-card', { id: 'overview-stat-1', width: 'fill_container' }),
        ref('stat-card', { id: 'overview-stat-2', width: 'fill_container' }, { 'stat-card-label': { content: 'New Customers' }, 'stat-card-value': { content: '1,234' }, 'stat-card-trend/badge-outline-label': { content: '-20%' }, 'stat-card-note': { content: 'Down 20% this period' } }),
        ref('stat-card', { id: 'overview-stat-3', width: 'fill_container' }, { 'stat-card-label': { content: 'Active Accounts' }, 'stat-card-value': { content: '45,678' }, 'stat-card-trend/badge-outline-label': { content: '+12.5%' }, 'stat-card-note': { content: 'Strong user retention' } })),
      row({ width: 'fill_container', gap: 16, height: 'fill_container' },
        ref('chart-card', { id: 'overview-chart', width: 'fill_container' }),
        ref('table', { id: 'overview-table', width: 'fill_container' }))));
  code(lib);
  return lib;
}

export const codeMeta = {
  library: 'shadcn/ui',
  setup: 'npx shadcn@latest init, then npx shadcn@latest add the components this file imports',
  inherited: ['font-sans', 'font-mono'],
};

/** shadcn/ui components as their code: https://ui.shadcn.com/docs/components. */
function code(lib: Library) {
  const ui = (...names: string[]) => (file: string) => Object.fromEntries(names.map((n) => [n, `@/components/ui/${file}`]));
  const button = ui('Button')('button');
  for (const [id, props] of [['button', ''], ['button-secondary', ' variant="secondary"'], ['button-outline', ' variant="outline"'], ['button-ghost', ' variant="ghost"'],
    ['button-destructive', ' variant="destructive"'], ['button-link', ' variant="link"'], ['button-sm', ' size="sm"'], ['button-lg', ' size="lg"']]) {
    lib.codeFor(id, `<Button${props}{class}>{text:${id}-label}</Button>`, button);
  }
  lib.codeFor('button-icon', '<Button variant="outline" size="icon"{class}>{icon:button-icon-glyph}</Button>', button);
  lib.codeFor('button-with-icon', '<Button{class}>{icon:button-with-icon-glyph} {text:button-with-icon-label}</Button>', button);
  lib.codeFor('label', '<Label{class}>{text:label-text}</Label>', ui('Label')('label'));
  lib.codeFor('input', '<Input placeholder="{attr:input-text}"{class} />', ui('Input')('input'));
  lib.codeFor('input-filled', '<Input defaultValue="{attr:input-filled-text}"{class} />', ui('Input')('input'));
  lib.codeFor('input-icon', '<div{class:relative}>\n  <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />\n  <Input className="pl-9" placeholder="{attr:input-icon-text}" />\n</div>', { ...ui('Input')('input'), Search: 'lucide-react' });
  lib.codeFor('textarea', '<Textarea placeholder="{attr:textarea-text}"{class} />', ui('Textarea')('textarea'));
  lib.codeFor('select', '<Select>\n  <SelectTrigger{class}>\n    <SelectValue placeholder="{attr:select-text}" />\n  </SelectTrigger>\n  <SelectContent />\n</Select>', ui('Select', 'SelectContent', 'SelectTrigger', 'SelectValue')('select'));
  lib.codeFor('field', '<div{class:grid gap-2}>\n  <Label htmlFor="{slug:field-label/label-text}">{text:field-label/label-text}</Label>\n  <Input id="{slug:field-label/label-text}" placeholder="{attr:field-input/input-text}" />\n  {if:field-description}<p className="text-muted-foreground text-sm">{text:field-description}</p>{/if}\n</div>', { ...ui('Label')('label'), ...ui('Input')('input') });
  for (const [id, on] of [['checkbox', ' defaultChecked'], ['checkbox-off', '']]) {
    lib.codeFor(id, `<div{class:flex items-center gap-2}>\n  <Checkbox id="{slug:${id}-label}"${on} />\n  <Label htmlFor="{slug:${id}-label}">{text:${id}-label}</Label>\n</div>`, { ...ui('Checkbox')('checkbox'), ...ui('Label')('label') });
  }
  for (const id of ['radio', 'radio-off']) {
    lib.codeFor(id, `<RadioGroup${id === 'radio' ? ' defaultValue="{slug:radio-label}"' : ''}{class}>\n  <div className="flex items-center gap-2">\n    <RadioGroupItem value="{slug:${id}-label}" id="{slug:${id}-label}" />\n    <Label htmlFor="{slug:${id}-label}">{text:${id}-label}</Label>\n  </div>\n</RadioGroup>`, { ...ui('RadioGroup', 'RadioGroupItem')('radio-group'), ...ui('Label')('label') });
  }
  for (const [id, on] of [['switch', ' defaultChecked'], ['switch-off', '']]) {
    lib.codeFor(id, `<div{class:flex items-center gap-2}>\n  <Switch id="{slug:${id}-label}"${on} />\n  {if:${id}-label}<Label htmlFor="{slug:${id}-label}">{text:${id}-label}</Label>{/if}\n</div>`, { ...ui('Switch')('switch'), ...ui('Label')('label') });
  }
  lib.codeFor('slider', '<Slider defaultValue={[50]} max={100} step={1}{class} />', ui('Slider')('slider'));
  lib.codeFor('toggle', '<Toggle aria-label="Toggle" defaultPressed{class}>{icon:toggle-icon}</Toggle>', ui('Toggle')('toggle'));
  lib.codeFor('toggle-off', '<Toggle aria-label="Toggle"{class}>{icon:toggle-off-icon}</Toggle>', ui('Toggle')('toggle'));
  const badge = ui('Badge')('badge');
  for (const [id, props] of [['badge', ''], ['badge-secondary', ' variant="secondary"'], ['badge-outline', ' variant="outline"'], ['badge-destructive', ' variant="destructive"']]) {
    lib.codeFor(id, `<Badge${props}{class}>{text:${id}-label}</Badge>`, badge);
  }
  lib.codeFor('avatar', '<Avatar{class}>\n  <AvatarFallback>{text:avatar-initials}</AvatarFallback>\n</Avatar>', ui('Avatar', 'AvatarFallback')('avatar'));
  lib.codeFor('avatar-group', '<div{class:flex -space-x-2}>{children:.}</div>', {});
  lib.codeFor('separator', '<Separator{class} />', ui('Separator')('separator'));
  lib.codeFor('progress', '<Progress value={60}{class} />', ui('Progress')('progress'));
  lib.codeFor('kbd', '<Kbd{class}>{text:kbd-text}</Kbd>', ui('Kbd')('kbd'));
  for (const [id, props] of [['alert', ''], ['alert-destructive', ' variant="destructive"']]) {
    lib.codeFor(id, `<Alert${props}{class}>\n  {icon:${id}-icon}\n  <AlertTitle>{text:${id}-title}</AlertTitle>\n  <AlertDescription>{text:${id}-description}</AlertDescription>\n</Alert>`, ui('Alert', 'AlertDescription', 'AlertTitle')('alert'));
  }
  lib.codeFor('card', '<Card{class}>\n  <CardHeader>\n    <CardTitle>{text:card-title}</CardTitle>\n    <CardDescription>{text:card-description}</CardDescription>\n  </CardHeader>\n  <CardContent{layout:card-content}>{children:card-content}</CardContent>\n  <CardFooter{layout:card-footer}>{children:card-footer}</CardFooter>\n</Card>', ui('Card', 'CardContent', 'CardDescription', 'CardFooter', 'CardHeader', 'CardTitle')('card'));
  lib.codeFor('tabs', '<Tabs defaultValue="{slug:tabs-1-label}"{class}>\n  <TabsList>\n    <TabsTrigger value="{slug:tabs-1-label}">{text:tabs-1-label}</TabsTrigger>\n    <TabsTrigger value="{slug:tabs-2-label}">{text:tabs-2-label}</TabsTrigger>\n    <TabsTrigger value="{slug:tabs-3-label}">{text:tabs-3-label}</TabsTrigger>\n  </TabsList>\n</Tabs>', ui('Tabs', 'TabsList', 'TabsTrigger')('tabs'));
  lib.codeFor('breadcrumb', '<Breadcrumb{class}>\n  <BreadcrumbList>\n    <BreadcrumbItem><BreadcrumbLink href="#">{text:breadcrumb-1}</BreadcrumbLink></BreadcrumbItem>\n    <BreadcrumbSeparator />\n    <BreadcrumbItem><BreadcrumbLink href="#">{text:breadcrumb-2}</BreadcrumbLink></BreadcrumbItem>\n    <BreadcrumbSeparator />\n    <BreadcrumbItem><BreadcrumbPage>{text:breadcrumb-page}</BreadcrumbPage></BreadcrumbItem>\n  </BreadcrumbList>\n</Breadcrumb>', ui('Breadcrumb', 'BreadcrumbItem', 'BreadcrumbLink', 'BreadcrumbList', 'BreadcrumbPage', 'BreadcrumbSeparator')('breadcrumb'));
  lib.codeFor('calendar', '<Calendar mode="single"{class:rounded-lg border} />', ui('Calendar')('calendar'));
}
