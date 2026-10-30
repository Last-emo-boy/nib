// nib's HeroUI library: HeroUI v3 (Apache-2.0) components and its default theme, drawn as .pen components.
// Sizes, radii and shadows follow @heroui/styles' component classes; colors come from its theme variables.
import { alpha, col, ellipse, frame, icon, Library, mix, oklch, rect, ref, row, show, text, themedColors, type N } from './kit.ts';

const L = (v: string) => oklch(v);
const white = '#FFFFFF', snow = L('oklch(0.9911 0 0)'), eclipse = L('oklch(0.2103 0.0059 285.89)');
const accent = L('oklch(0.6204 0.195 253.83)'), success = L('oklch(0.7329 0.1935 150.81)');

/** The variables HeroUI derives with color-mix(), from a mode's base colors. */
function derived(c: Record<string, string>, soft: number, softInk: Record<string, number>) {
  return {
    'default-hover': mix(c.default, c['default-foreground'], 0.04),
    'accent-hover': mix(c.accent, c['accent-foreground'], 0.1),
    'danger-hover': mix(c.danger, c['danger-foreground'], 0.1),
    'default-soft': alpha(c.default, 0.5),
    'accent-soft': alpha(c.accent, soft), 'accent-soft-foreground': mix(c.accent, c.foreground, softInk.accent),
    'success-soft': alpha(c.success, soft), 'success-soft-foreground': mix(c.success, c.foreground, softInk.success),
    'warning-soft': alpha(c.warning, soft), 'warning-soft-foreground': mix(c.warning, c.foreground, softInk.warning),
    'danger-soft': alpha(c.danger, 0.15), 'danger-soft-foreground': mix(c.danger, c.foreground, softInk.danger),
    'separator-tertiary': mix(c.surface, c.foreground, 0.19),
  };
}

const lightBase = {
  background: L('oklch(0.9702 0 0)'), foreground: eclipse,
  surface: white, 'surface-secondary': L('oklch(0.9524 0.0013 286.37)'), 'surface-tertiary': L('oklch(0.9373 0.0013 286.37)'),
  overlay: white, muted: L('oklch(0.5517 0.0138 285.94)'),
  default: L('oklch(94% 0.001 286.375)'), 'default-foreground': eclipse,
  accent, 'accent-foreground': snow, success, 'success-foreground': eclipse,
  warning: L('oklch(0.7819 0.1585 72.33)'), 'warning-foreground': eclipse,
  danger: L('oklch(0.6532 0.2328 25.74)'), 'danger-foreground': snow,
  'field-background': white, 'field-foreground': eclipse,
  segment: white, 'segment-foreground': eclipse,
  border: L('oklch(90% 0.004 286.32)'), separator: L('oklch(92% 0.004 286.32)'),
};
const darkBase = {
  background: L('oklch(12% 0.005 285.823)'), foreground: snow,
  surface: eclipse, 'surface-secondary': L('oklch(0.257 0.0037 286.14)'), 'surface-tertiary': L('oklch(0.2721 0.0024 247.91)'),
  overlay: eclipse, muted: L('oklch(70.5% 0.015 286.067)'),
  default: L('oklch(27.4% 0.006 286.033)'), 'default-foreground': snow,
  accent, 'accent-foreground': snow, success, 'success-foreground': eclipse,
  warning: L('oklch(0.8203 0.1388 76.34)'), 'warning-foreground': eclipse,
  danger: L('oklch(0.594 0.1967 24.63)'), 'danger-foreground': snow,
  'field-background': eclipse, 'field-foreground': snow,
  segment: L('oklch(0.3964 0.01 285.93)'), 'segment-foreground': snow,
  border: L('oklch(28% 0.006 286.033)'), separator: L('oklch(25% 0.006 286.033)'),
};
const clear = '#00000000';
const light = {
  ...lightBase, ...derived(lightBase, 0.15, { accent: 0.3, success: 0.43, warning: 0.47, danger: 0.36 }),
  // HeroUI's shadows, whose colors fade out in dark mode, and the hairline edge dark overlays get instead.
  'shadow-1': '#0000000A', 'shadow-2': '#0000000F', 'shadow-overlay-1': '#0000000F', 'shadow-overlay-2': '#00000008', 'shadow-overlay-3': '#00000014',
  'overlay-edge': '#FFFFFF00',
};
const dark = {
  ...darkBase, ...derived(darkBase, 0.12, { accent: 0.27, success: 0.27, warning: 0.27, danger: 0.27 }),
  'shadow-1': clear, 'shadow-2': clear, 'shadow-overlay-1': clear, 'shadow-overlay-2': clear, 'shadow-overlay-3': clear,
  'overlay-edge': '#FFFFFF2E',
};

const shadow = (x: number, y: number, blur: number, color: string) => ({ type: 'shadow', offset: { x, y }, blur, color });
const surfaceShadow = [shadow(0, 2, 4, '$shadow-1'), shadow(0, 1, 2, '$shadow-2'), shadow(0, 0, 1, '$shadow-2')];
const overlayShadow = [shadow(0, 2, 8, '$shadow-overlay-1'), shadow(0, -6, 12, '$shadow-overlay-2'), shadow(0, 14, 28, '$shadow-overlay-3')];
const overlay = { fill: '$overlay', effect: overlayShadow, stroke: '$overlay-edge', strokeWidth: 1, strokeAlignment: 'inner' };

const font = '$font-sans';
const t = (content: string, props: N = {}) => text(content, { fontFamily: font, fontSize: 14, fill: '$foreground', lineHeight: 1.43, ...props });
const muted = (content: string, props: N = {}) => t(content, { fill: '$muted', ...props });
const medium = (content: string, props: N = {}) => t(content, { fontWeight: '500', ...props });
const heading = (content: string) => t(content, { fontSize: 24, fontWeight: '600', lineHeight: 1.2 });
const caption = (content: string) => muted(content, { fontSize: 13 });
const group = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 16, alignItems: 'center' }, ...items));
const tall = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 24, alignItems: 'start' }, ...items));

export const meta = {
  id: 'heroui',
  name: 'HeroUI',
  summary: {
    en: 'Soft, rounded components from HeroUI v3: pill buttons, chips, fields, cards, menus, a team table and a dashboard to start from.',
    zh: 'HeroUI v3 的柔和圆润组件：胶囊按钮、标签、输入框、卡片、菜单、成员表格，以及一个可直接起步的仪表盘。',
  },
  basedOn: 'HeroUI v3 (default theme)',
  license: 'Apache-2.0',
  homepage: 'https://heroui.com',
  /** Which variables follow a brand's color, radius and font (see the daemon's brand.ts). */
  brand: { anchor: 'accent', radius: 'radius', font: 'font-sans', vars: { 'accent-foreground': 'on', 'accent-hover': 'recolor', 'accent-soft': 'recolor', 'accent-soft-foreground': 'recolor' } },
};

export function heroui(): Library {
  const lib = new Library('heroui', { Mode: ['Light', 'Dark'] });
  Object.assign(lib.variables, themedColors(light, dark), {
    'font-sans': { type: 'string', value: 'Inter' },
    radius: { type: 'number', value: 8 },
    'radius-md': { type: 'number', value: 6 }, 'radius-lg': { type: 'number', value: 8 }, 'radius-xl': { type: 'number', value: 12 },
    'radius-2xl': { type: 'number', value: 16 }, 'radius-3xl': { type: 'number', value: 24 }, 'field-radius': { type: 'number', value: 12 },
  });

  // Buttons --------------------------------------------------------------------------------------
  const button = (id: string, name: string, look: N, ink: string, size: 'sm' | 'md' | 'lg' = 'md') => lib.component(id, name, row({
    height: size === 'sm' ? 32 : size === 'lg' ? 40 : 36, padding: [0, size === 'sm' ? 12 : 16], gap: 8,
    alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-3xl', ...look,
  }, medium('Button', { id: `${id}-label`, fill: ink, ...(size === 'lg' ? { fontSize: 16, lineHeight: 1.5 } : {}) })));
  button('button', 'Button / Primary', { fill: '$accent' }, '$accent-foreground');
  button('button-secondary', 'Button / Secondary', { fill: '$default' }, '$accent-soft-foreground');
  button('button-tertiary', 'Button / Tertiary', { fill: '$default' }, '$default-foreground');
  button('button-outline', 'Button / Outline', { stroke: '$border', strokeWidth: 1 }, '$default-foreground');
  button('button-ghost', 'Button / Ghost', {}, '$default-foreground');
  button('button-danger', 'Button / Danger', { fill: '$danger' }, '$danger-foreground');
  button('button-danger-soft', 'Button / Danger Soft', { fill: '$danger-soft' }, '$danger-soft-foreground');
  button('button-sm', 'Button / Small', { fill: '$accent' }, '$accent-foreground', 'sm');
  button('button-lg', 'Button / Large', { fill: '$accent' }, '$accent-foreground', 'lg');
  lib.component('button-icon', 'Button / Icon', row({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-3xl', fill: '$default' },
    icon('bell', { id: 'button-icon-glyph', fill: '$default-foreground' })));
  lib.component('button-with-icon', 'Button / With Icon', row({ height: 36, padding: [0, 16, 0, 14], gap: 8, alignItems: 'center', cornerRadius: '$radius-3xl', fill: '$accent' },
    icon('plus', { id: 'button-with-icon-glyph', fill: '$accent-foreground' }),
    medium('New project', { id: 'button-with-icon-label', fill: '$accent-foreground' })));

  // Chips ----------------------------------------------------------------------------------------
  const chip = (id: string, name: string, bg: string, ink: string, label: string) => lib.component(id, name, row({ padding: [2, 10], alignItems: 'center', cornerRadius: '$radius-2xl', fill: bg },
    medium(label, { id: `${id}-label`, fontSize: 12, lineHeight: 1.67, fill: ink })));
  chip('chip', 'Chip / Default', '$default', '$default-foreground', 'Default');
  chip('chip-accent', 'Chip / Accent', '$accent-soft', '$accent-soft-foreground', 'Accent');
  chip('chip-success', 'Chip / Success', '$success-soft', '$success-soft-foreground', 'Active');
  chip('chip-warning', 'Chip / Warning', '$warning-soft', '$warning-soft-foreground', 'Pending');
  chip('chip-danger', 'Chip / Danger', '$danger-soft', '$danger-soft-foreground', 'Blocked');
  chip('chip-solid', 'Chip / Solid', '$accent', '$accent-foreground', 'New');

  // Form controls --------------------------------------------------------------------------------
  const field = { height: 36, padding: [0, 12], gap: 8, alignItems: 'center', cornerRadius: '$field-radius', fill: '$field-background', effect: surfaceShadow };
  lib.component('label', 'Label', row({}, medium('Label', { id: 'label-text' })));
  lib.component('description', 'Description', row({}, muted('Helper text goes here.', { id: 'description-text', fontSize: 12, lineHeight: 1.33 })));
  lib.component('input', 'Input', row({ ...field, width: 280 }, muted('you@example.com', { id: 'input-text', width: 'fill_container' })));
  lib.component('input-filled', 'Input / Filled', row({ ...field, width: 280 }, t('junior@heroui.com', { id: 'input-filled-text', fill: '$field-foreground', width: 'fill_container' })));
  lib.component('search-field', 'Search Field', row({ ...field, width: 280 }, icon('search', { fill: '$muted' }), muted('Search…', { id: 'search-field-text', width: 'fill_container' })));
  lib.component('textarea', 'Textarea', row({ ...field, height: 88, width: 280, alignItems: 'start', padding: [8, 12] }, muted('Tell us a little about yourself', { id: 'textarea-text', width: 'fill_container' })));
  lib.component('select', 'Select', row({ ...field, width: 200 }, muted('Select a country', { id: 'select-text', width: 'fill_container' }), icon('chevron-down', { fill: '$muted' })));
  lib.component('text-field', 'Text Field', col({ gap: 4, width: 280 },
    ref('label', { id: 'text-field-label' }, { 'label-text': { content: 'Email' } }),
    ref('input', { id: 'text-field-input', width: 'fill_container' }),
    ref('description', { id: 'text-field-description' }, { 'description-text': { content: "We'll never share your email." } })));

  const control = (shape: N, on: boolean, mark: N): N => frame({ width: 16, height: 16, layout: 'horizontal', alignItems: 'center', justifyContent: 'center', ...shape,
    ...(on ? { fill: '$accent' } : { fill: '$field-background', effect: surfaceShadow }) }, ...(on ? [mark] : []));
  const check = control({ cornerRadius: '$radius-md' }, true, icon('check', { width: 10, height: 10, fill: '$accent-foreground' }));
  const dot = control({ cornerRadius: 8 }, true, ellipse({ width: 6, height: 6, fill: '$accent-foreground' }));
  lib.component('checkbox', 'Checkbox / Checked', row({ gap: 12, alignItems: 'center' }, check, t('Subscribe to updates', { id: 'checkbox-label' })));
  lib.component('checkbox-off', 'Checkbox / Unchecked', row({ gap: 12, alignItems: 'center' }, control({ cornerRadius: '$radius-md' }, false, {}), t('Remember me', { id: 'checkbox-off-label' })));
  lib.component('radio', 'Radio / Selected', row({ gap: 12, alignItems: 'center' }, dot, t('Monthly', { id: 'radio-label' })));
  lib.component('radio-off', 'Radio / Unselected', row({ gap: 12, alignItems: 'center' }, control({ cornerRadius: 8 }, false, {}), t('Yearly', { id: 'radio-off-label' })));
  const sw = (on: boolean): N => frame({ width: 40, height: 20, cornerRadius: 10, layout: 'horizontal', alignItems: 'center', justifyContent: on ? 'end' : 'start', padding: 2, fill: on ? '$accent' : '$default' },
    frame({ width: 22, height: 16, cornerRadius: 8, fill: on ? '$accent-foreground' : white, effect: surfaceShadow }));
  lib.component('switch', 'Switch / On', row({ gap: 12, alignItems: 'center' }, sw(true), t('Wi-Fi', { id: 'switch-label' })));
  lib.component('switch-off', 'Switch / Off', row({ gap: 12, alignItems: 'center' }, sw(false), t('Bluetooth', { id: 'switch-off-label' })));
  lib.component('slider', 'Slider', col({ gap: 6, width: 240 },
    row({ width: 'fill_container', justifyContent: 'space_between' }, medium('Volume', { id: 'slider-label' }), medium('60', { id: 'slider-value' })),
    frame({ width: 'fill_container', height: 20, layout: 'none' },
      rect({ x: 0, y: 6, width: 240, height: 8, cornerRadius: '$radius-xl', fill: '$default' }),
      rect({ id: 'slider-fill', x: 0, y: 6, width: 144, height: 8, cornerRadius: '$radius-xl', fill: '$accent' }),
      frame({ id: 'slider-thumb', x: 130, y: 2, width: 28, height: 16, cornerRadius: 8, fill: white, effect: surfaceShadow }))));
  lib.component('progress', 'Progress', col({ gap: 6, width: 240 },
    row({ width: 'fill_container', justifyContent: 'space_between' }, medium('Uploading', { id: 'progress-label' }), medium('40%', { id: 'progress-value' })),
    frame({ width: 'fill_container', height: 8, cornerRadius: 4, fill: '$default', layout: 'none', clip: true },
      rect({ id: 'progress-fill', x: 0, y: 0, width: 96, height: 8, cornerRadius: 4, fill: '$accent' }))));

  // Display --------------------------------------------------------------------------------------
  lib.component('avatar', 'Avatar', row({ width: 40, height: 40, cornerRadius: 20, alignItems: 'center', justifyContent: 'center', fill: '$default', clip: true },
    medium('JR', { id: 'avatar-initials', fill: '$default-foreground' })));
  lib.component('avatar-accent', 'Avatar / Accent', row({ width: 40, height: 40, cornerRadius: 20, alignItems: 'center', justifyContent: 'center', fill: '$accent-soft', clip: true },
    medium('AK', { id: 'avatar-accent-initials', fill: '$accent-soft-foreground' })));
  lib.component('avatar-group', 'Avatar Group', row({ gap: -10 },
    ...['JR', 'AK', 'MS', '+3'].map((c, i) => ref('avatar', { id: `avatar-group-${i + 1}`, stroke: '$background', strokeWidth: 2, strokeAlignment: 'outer' }, { 'avatar-initials': { content: c } }))));
  lib.component('kbd', 'Kbd', row({ height: 24, padding: [0, 8], gap: 2, cornerRadius: '$radius-lg', fill: '$default', alignItems: 'center' },
    medium('⌘', { fill: '$muted' }), medium('K', { id: 'kbd-key', fill: '$muted' })));
  lib.component('tooltip', 'Tooltip', row({ padding: 8, cornerRadius: '$radius-xl', ...overlay },
    t('Copy to clipboard', { id: 'tooltip-text', fontSize: 12, lineHeight: 1.33 })));
  lib.component('separator', 'Separator', rect({ width: 240, height: 1, fill: '$separator' }));
  lib.component('skeleton', 'Skeleton', col({ width: 260, padding: 16, gap: 12, cornerRadius: '$radius-3xl', fill: '$surface', effect: surfaceShadow },
    rect({ width: 'fill_container', height: 96, cornerRadius: '$radius-xl', fill: '$default' }),
    rect({ width: 180, height: 12, cornerRadius: '$radius-lg', fill: '$default' }),
    rect({ width: 120, height: 12, cornerRadius: '$radius-lg', fill: '$default' })));
  const alert = (id: string, name: string, glyph: string, ink: string, title: string, body: string) => lib.component(id, name, row({ width: 420, padding: [12, 16], gap: 16, cornerRadius: '$radius-3xl', fill: '$surface', effect: surfaceShadow },
    row({ padding: 4 }, icon(glyph, { id: `${id}-icon`, fill: ink })),
    col({ width: 'fill_container' }, medium(title, { id: `${id}-title`, fill: ink, lineHeight: 1.71 }), muted(body, { id: `${id}-description`, width: 'fill_container' }))));
  alert('alert', 'Alert / Accent', 'info', '$accent-soft-foreground', 'New features available', 'Check out the dashboard: custom themes and team roles are here.');
  alert('alert-success', 'Alert / Success', 'circle-check', '$success-soft-foreground', 'Payment received', 'Your invoice #4821 has been paid. A receipt is on its way.');
  alert('alert-danger', 'Alert / Danger', 'circle-alert', '$danger-soft-foreground', 'Unable to connect', 'Check your network settings and try again.');

  // Cards ----------------------------------------------------------------------------------------
  lib.component('card', 'Card', col({ width: 340, padding: 16, gap: 12, cornerRadius: '$radius-3xl', fill: '$surface', effect: surfaceShadow },
    row({ id: 'card-media', width: 'fill_container', height: 140, cornerRadius: '$radius-2xl', fill: '$accent-soft', alignItems: 'center', justifyContent: 'center' },
      icon('sparkles', { width: 32, height: 32, fill: '$accent-soft-foreground' })),
    col({ id: 'card-header', width: 'fill_container' },
      medium('Become an Acme creator', { id: 'card-title', lineHeight: 1.71 }),
      muted('Share your templates with the community and get paid for every download.', { id: 'card-description', width: 'fill_container' })),
    row({ id: 'card-footer', gap: 8, width: 'fill_container', alignItems: 'center' },
      ref('button', { id: 'card-action' }, { 'button-label': { content: 'Apply now' } }),
      ref('button-ghost', { id: 'card-secondary' }, { 'button-ghost-label': { content: 'Learn more' } }))));
  lib.component('stat-card', 'Stat Card', col({ width: 260, padding: 20, gap: 8, cornerRadius: '$radius-3xl', fill: '$surface', effect: surfaceShadow },
    row({ width: 'fill_container', alignItems: 'center', justifyContent: 'space_between' },
      muted('Monthly revenue', { id: 'stat-card-label' }), ref('chip-success', { id: 'stat-card-trend' }, { 'chip-success-label': { content: '+12.4%' } })),
    t('$48,290', { id: 'stat-card-value', fontSize: 28, fontWeight: '600', lineHeight: 1.25 }),
    muted('vs. $42,960 last month', { id: 'stat-card-note', fontSize: 12, lineHeight: 1.33 })));

  // Navigation -----------------------------------------------------------------------------------
  const tab = (id: string, label: string, on: boolean): N => row({ id, height: 32, padding: [0, 16], alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-3xl',
    ...(on ? { fill: '$segment', effect: surfaceShadow } : {}) }, medium(label, { id: `${id}-label`, fill: on ? '$segment-foreground' : '$muted' }));
  lib.component('tabs', 'Tabs', row({ padding: 4, cornerRadius: '$radius-3xl', fill: '$default', alignItems: 'center' },
    tab('tabs-1', 'Photos', true), tab('tabs-2', 'Music', false), tab('tabs-3', 'Videos', false)));
  const sep = () => icon('chevron-right', { width: 14, height: 14, fill: '$muted' });
  lib.component('breadcrumbs', 'Breadcrumbs', row({ gap: 6, alignItems: 'center' },
    medium('Home', { fill: '$muted' }), sep(), medium('Projects', { fill: '$muted' }), sep(), medium('HeroUI', { id: 'breadcrumbs-current' })));
  const pageLink = (label: string, on = false): N => row({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius-3xl', ...(on ? { fill: '$default' } : {}) },
    medium(label, { fill: on ? '$default-foreground' : '$muted' }));
  lib.component('pagination', 'Pagination', row({ gap: 4, alignItems: 'center' },
    row({ height: 32, padding: [0, 10], gap: 6, alignItems: 'center', cornerRadius: '$radius-3xl' }, icon('chevron-left', { fill: '$foreground' }), medium('Previous')),
    pageLink('1'), pageLink('2', true), pageLink('3'), pageLink('…'), pageLink('10'),
    row({ height: 32, padding: [0, 10], gap: 6, alignItems: 'center', cornerRadius: '$radius-3xl' }, medium('Next'), icon('chevron-right', { fill: '$foreground' }))));
  const item = (glyph: string, label: string, keys?: string, look: 'focused' | 'danger' | 'normal' = 'normal'): N => row({ width: 'fill_container', height: 36, padding: [6, 8], gap: 12, alignItems: 'center', cornerRadius: '$radius-2xl',
    ...(look === 'focused' ? { fill: '$default' } : {}) },
  icon(glyph, { fill: look === 'danger' ? '$danger' : '$muted' }), t(label, { width: 'fill_container', fill: look === 'danger' ? '$danger' : '$foreground' }),
  ...(keys ? [muted(keys, { fontSize: 12 })] : []));
  lib.component('dropdown', 'Dropdown Menu', col({ width: 240, padding: 4, gap: 2, cornerRadius: 22, ...overlay },
    row({ padding: [6, 8] }, muted('Actions', { fontSize: 12, fontWeight: '500' })),
    item('file-plus', 'New file', '⌘N', 'focused'), item('copy', 'Copy link', '⌘C'), item('pencil', 'Edit file', '⌘E'),
    rect({ width: 'fill_container', height: 1, fill: '$separator' }),
    item('trash-2', 'Delete file', '⌘⇧D', 'danger')));
  const accordionItem = (id: string, title: string, open: boolean, last = false): N => col({ id, width: 'fill_container', ...(last ? {} : { stroke: '$separator', strokeWidth: { bottom: 1 } }) },
    row({ padding: 16, alignItems: 'center', width: 'fill_container' }, medium(title, { id: `${id}-title`, width: 'fill_container' }), icon(open ? 'chevron-up' : 'chevron-down', { fill: '$muted' })),
    ...(open ? [row({ padding: [0, 16, 16, 16], width: 'fill_container' }, muted('Free for personal projects. Teams pay per seat, billed monthly or yearly, and can cancel any time.', { id: `${id}-body`, width: 'fill_container' }))] : []));
  lib.component('accordion', 'Accordion', col({ width: 420, cornerRadius: '$radius-3xl', fill: '$surface', effect: surfaceShadow, clip: true },
    accordionItem('accordion-1', 'How much does it cost?', true), accordionItem('accordion-2', 'Can I use it offline?', false), accordionItem('accordion-3', 'Is there a free trial?', false, true)));

  // Overlays -------------------------------------------------------------------------------------
  lib.component('modal', 'Modal', col({ width: 440, padding: 24, gap: 16, cornerRadius: '$radius-3xl', ...overlay },
    row({ width: 40, height: 40, cornerRadius: 20, fill: '$accent-soft', alignItems: 'center', justifyContent: 'center' }, icon('rocket', { id: 'modal-icon', width: 20, height: 20, fill: '$accent-soft-foreground' })),
    col({ gap: 6, width: 'fill_container' },
      medium('Publish your workspace?', { id: 'modal-title', fontSize: 16, lineHeight: 1.5 }),
      muted('Everyone with the link will be able to view it. You can make it private again at any time.', { id: 'modal-description', width: 'fill_container' })),
    row({ gap: 8, justifyContent: 'end', width: 'fill_container' },
      ref('button-tertiary', { id: 'modal-cancel' }, { 'button-tertiary-label': { content: 'Cancel' } }),
      ref('button', { id: 'modal-confirm' }, { 'button-label': { content: 'Publish' } }))));
  lib.component('popover', 'Popover', col({ width: 280, padding: 16, gap: 4, cornerRadius: '$radius-3xl', ...overlay },
    medium('Shared with 4 people', { id: 'popover-title' }),
    muted('Anyone on your team can edit this project.', { id: 'popover-description', width: 'fill_container' })));
  lib.component('toast', 'Toast', row({ width: 380, padding: [12, 12, 12, 16], gap: 12, alignItems: 'center', cornerRadius: '$radius-3xl', ...overlay },
    icon('circle-check', { id: 'toast-icon', fill: '$success-soft-foreground' }),
    col({ width: 'fill_container' }, medium('Changes saved', { id: 'toast-title' }), muted('Your profile was updated.', { id: 'toast-description', fontSize: 13 })),
    ref('button-sm', { id: 'toast-action', fill: '$default' }, { 'button-sm-label': { content: 'Undo', fill: '$default-foreground' } })));

  // Data -----------------------------------------------------------------------------------------
  const people: [string, string, string, string, string][] = [
    ['JR', 'Junior Garcia', 'junior@acme.com', 'Owner', 'chip-success'], ['AK', 'Ava Kim', 'ava@acme.com', 'Admin', 'chip-success'],
    ['MS', 'Mateo Silva', 'mateo@acme.com', 'Editor', 'chip-warning'], ['LN', 'Lena Novak', 'lena@acme.com', 'Viewer', 'chip-danger'],
  ];
  const status: Record<string, string> = { 'chip-success': 'Active', 'chip-warning': 'Invited', 'chip-danger': 'Suspended' };
  const column = (s: string, w: N = { width: 'fill_container' }) => row({ ...w, padding: [10, 16] }, muted(s, { fontSize: 12, fontWeight: '500', lineHeight: 1.33 }));
  lib.component('table', 'Table', col({ width: 640, padding: [0, 4, 4, 4], cornerRadius: '$radius-3xl', fill: '$surface-secondary' },
    row({ width: 'fill_container' }, column('Name', { width: 'fill_container' }), column('Role', { width: 120 }), column('Status', { width: 120 }), column('', { width: 56 })),
    col({ width: 'fill_container', cornerRadius: 20, fill: '$surface', effect: surfaceShadow, clip: true },
      ...people.map(([ini, name, email, role, chipId], i) => row({ id: `table-row-${i + 1}`, width: 'fill_container', height: 60, alignItems: 'center', ...(i < people.length - 1 ? { stroke: '$separator', strokeWidth: { bottom: 1 } } : {}) },
        row({ width: 'fill_container', padding: [0, 16], gap: 12, alignItems: 'center' },
          ref('avatar', { id: `table-avatar-${i + 1}`, width: 32, height: 32, cornerRadius: 16 }, { 'avatar-initials': { content: ini, fontSize: 12 } }),
          col({}, medium(name), muted(email, { fontSize: 12, lineHeight: 1.33 }))),
        row({ width: 120, padding: [0, 16] }, t(role)),
        row({ width: 120, padding: [0, 16] }, ref(chipId, {}, { [`${chipId}-label`]: { content: status[chipId] } })),
        row({ width: 56, padding: [0, 16], justifyContent: 'end' }, icon('ellipsis', { fill: '$muted' })))))));

  // Boards ---------------------------------------------------------------------------------------
  lib.board('board-buttons', 'Buttons and chips', {}, heading('Buttons and chips'),
    group('Variants', show('button'), show('button-secondary'), show('button-tertiary'), show('button-outline'), show('button-ghost'), show('button-danger'), show('button-danger-soft')),
    group('Sizes and icons', show('button-sm'), show('button-lg'), show('button-icon'), show('button-with-icon')),
    group('Chips', show('chip'), show('chip-accent'), show('chip-success'), show('chip-warning'), show('chip-danger'), show('chip-solid')));
  lib.board('board-forms', 'Forms', {}, heading('Forms'),
    tall('Fields', show('text-field'), show('input'), show('input-filled')),
    tall('More fields', show('search-field'), show('textarea'), show('select')),
    group('Labels', show('label'), show('description')),
    group('Choices', show('checkbox'), show('checkbox-off'), show('radio'), show('radio-off'), show('switch'), show('switch-off')),
    group('Range', show('slider'), show('progress')));
  lib.board('board-display', 'Display', {}, heading('Display'),
    group('People and keys', show('avatar'), show('avatar-accent'), show('avatar-group'), show('kbd'), show('tooltip'), show('separator')),
    tall('Alerts', show('alert'), show('alert-success')),
    tall('Cards', show('card'), show('stat-card'), show('skeleton'), show('alert-danger')));
  lib.board('board-navigation', 'Navigation and overlays', {}, heading('Navigation and overlays'),
    group('Tabs and breadcrumbs', show('tabs'), show('breadcrumbs')),
    group('Pages', show('pagination')),
    tall('Menus and disclosure', show('dropdown'), show('accordion'), show('popover')),
    tall('Dialogs', show('modal'), show('toast')),
    tall('Data', show('table')));

  // The overview a new design starts from, and the dashboard's preview.
  const nav = (label: string, on = false) => medium(label, { fill: on ? '$foreground' : '$muted' });
  const settingRow = (id: string, title: string, note: string, on: boolean): N => row({ id, width: 'fill_container', gap: 12, alignItems: 'center' },
    col({ width: 'fill_container' }, medium(title), muted(note, { fontSize: 12, lineHeight: 1.33, width: 'fill_container' })),
    ref(on ? 'switch' : 'switch-off', { id: `${id}-switch` }, { [on ? 'switch-label' : 'switch-off-label']: { enabled: false } }));
  lib.board('overview', 'Overview', { width: 1440, height: 900, padding: 0, gap: 0, clip: true },
    row({ width: 'fill_container', height: 72, padding: [0, 32], gap: 32, alignItems: 'center' },
      row({ gap: 10, alignItems: 'center' },
        row({ width: 32, height: 32, cornerRadius: 10, fill: '$accent', alignItems: 'center', justifyContent: 'center' }, icon('sparkles', { fill: '$accent-foreground' })),
        t('Acme', { fontSize: 16, fontWeight: '600', lineHeight: 1.5 })),
      row({ gap: 24, alignItems: 'center', width: 'fill_container' }, nav('Dashboard'), nav('Projects'), nav('Team', true), nav('Settings')),
      ref('search-field', { id: 'overview-search', width: 260 }),
      ref('button-icon', { id: 'overview-bell' }),
      ref('avatar', { id: 'overview-avatar', width: 36, height: 36, cornerRadius: 18 })),
    col({ width: 'fill_container', height: 'fill_container', padding: [8, 32, 32, 32], gap: 24 },
      row({ width: 'fill_container', alignItems: 'end', justifyContent: 'space_between' },
        col({ gap: 4 }, t('Team', { fontSize: 28, fontWeight: '600', lineHeight: 1.25 }), muted('Manage members, roles and invitations for your workspace.')),
        row({ gap: 8 }, ref('button-tertiary', { id: 'overview-export' }, { 'button-tertiary-label': { content: 'Export' } }),
          ref('button-with-icon', { id: 'overview-invite' }, { 'button-with-icon-glyph': { icon: 'user-plus' }, 'button-with-icon-label': { content: 'Invite member' } }))),
      ref('tabs', { id: 'overview-tabs' }, { 'tabs-1-label': { content: 'Members' }, 'tabs-2-label': { content: 'Invitations' }, 'tabs-3-label': { content: 'Roles' } }),
      row({ width: 'fill_container', gap: 16 },
        ref('stat-card', { id: 'overview-stat-1', width: 'fill_container' }, { 'stat-card-label': { content: 'Members' }, 'stat-card-value': { content: '24' }, 'stat-card-trend/chip-success-label': { content: '+3' }, 'stat-card-note': { content: '3 joined this month' } }),
        ref('stat-card', { id: 'overview-stat-2', width: 'fill_container' }, { 'stat-card-label': { content: 'Seats used' }, 'stat-card-value': { content: '24 / 30' }, 'stat-card-trend/chip-success-label': { content: '80%' }, 'stat-card-note': { content: '6 seats left on your plan' } }),
        ref('stat-card', { id: 'overview-stat-3', width: 'fill_container' }, { 'stat-card-label': { content: 'Monthly cost' }, 'stat-card-value': { content: '$720' }, 'stat-card-trend': { enabled: false }, 'stat-card-note': { content: 'Next invoice on Nov 1' } })),
      row({ width: 'fill_container', gap: 16, alignItems: 'start' },
        ref('table', { id: 'overview-table', width: 'fill_container' }),
        col({ width: 380, padding: 20, gap: 16, cornerRadius: '$radius-3xl', fill: '$surface', effect: surfaceShadow },
          col({ width: 'fill_container' }, medium('Workspace', { lineHeight: 1.71 }), muted('How new members join and what they can see.', { width: 'fill_container' })),
          ref('text-field', { id: 'overview-domain', width: 'fill_container' }, { 'text-field-label/label-text': { content: 'Allowed domain' }, 'text-field-input': { fill: '$default', effect: [] }, 'text-field-input/input-text': { content: 'acme.com', fill: '$field-foreground' }, 'text-field-description/description-text': { content: 'People with this email domain can join without an invite.' } }),
          settingRow('overview-setting-1', 'Require approval', 'An admin approves each new member.', true),
          settingRow('overview-setting-2', 'Public projects', 'Members can share projects by link.', false),
          row({ width: 'fill_container', gap: 8, justifyContent: 'end' },
            ref('button-ghost', { id: 'overview-reset' }, { 'button-ghost-label': { content: 'Reset' } }),
            ref('button', { id: 'overview-save' }, { 'button-label': { content: 'Save changes' } }))))));
  code(lib);
  return lib;
}

export const codeMeta = {
  library: 'HeroUI',
  setup: 'npm install @heroui/react @heroui/styles, and import "@heroui/styles" in your global CSS',
  inherited: ['font-sans'],
};

/** HeroUI v3 components as their code: https://heroui.com/docs/react/components. */
function code(lib: Library) {
  const hero = (...names: string[]) => Object.fromEntries(names.map((n) => [n, '@heroui/react']));
  for (const [id, props] of [['button', ''], ['button-secondary', ' variant="secondary"'], ['button-tertiary', ' variant="tertiary"'], ['button-outline', ' variant="outline"'],
    ['button-ghost', ' variant="ghost"'], ['button-danger', ' variant="danger"'], ['button-danger-soft', ' variant="danger-soft"'], ['button-sm', ' size="sm"'], ['button-lg', ' size="lg"']]) {
    lib.codeFor(id, `<Button${props}{class}>{text:${id}-label}</Button>`, hero('Button'));
  }
  lib.codeFor('button-icon', '<Button isIconOnly variant="tertiary" aria-label="{attr:button-icon-glyph}"{class}>{icon:button-icon-glyph}</Button>', hero('Button'));
  lib.codeFor('button-with-icon', '<Button{class}>{icon:button-with-icon-glyph}{text:button-with-icon-label}</Button>', hero('Button'));
  for (const [id, props] of [['chip', ''], ['chip-accent', ' color="accent" variant="soft"'], ['chip-success', ' color="success" variant="soft"'], ['chip-warning', ' color="warning" variant="soft"'],
    ['chip-danger', ' color="danger" variant="soft"'], ['chip-solid', ' color="accent" variant="primary"']]) {
    lib.codeFor(id, `<Chip${props}{class}>{text:${id}-label}</Chip>`, hero('Chip'));
  }
  lib.codeFor('label', '<Label{class}>{text:label-text}</Label>', hero('Label'));
  lib.codeFor('description', '<Description{class}>{text:description-text}</Description>', hero('Description'));
  lib.codeFor('input', '<Input placeholder="{attr:input-text}"{class} />', hero('Input'));
  lib.codeFor('input-filled', '<Input defaultValue="{attr:input-filled-text}"{class} />', hero('Input'));
  lib.codeFor('textarea', '<TextArea placeholder="{attr:textarea-text}"{class} />', hero('TextArea'));
  lib.codeFor('search-field', '<SearchField aria-label="Search"{class}>\n  <SearchField.Group>\n    <SearchField.SearchIcon />\n    <SearchField.Input placeholder="{attr:search-field-text}" />\n    <SearchField.ClearButton />\n  </SearchField.Group>\n</SearchField>', hero('SearchField'));
  lib.codeFor('text-field', '<TextField name="{slug:text-field-label/label-text}"{class}>\n  <Label>{text:text-field-label/label-text}</Label>\n  <Input placeholder="{attr:text-field-input/input-text}" />\n  {if:text-field-description/description-text}<Description>{text:text-field-description/description-text}</Description>{/if}\n</TextField>', hero('Description', 'Input', 'Label', 'TextField'));
  for (const [id, on] of [['checkbox', ' defaultSelected'], ['checkbox-off', '']]) {
    lib.codeFor(id, `<Checkbox name="{slug:${id}-label}"${on}{class}>\n  <Checkbox.Content>\n    <Checkbox.Control>\n      <Checkbox.Indicator />\n    </Checkbox.Control>\n    {text:${id}-label}\n  </Checkbox.Content>\n</Checkbox>`, hero('Checkbox'));
  }
  for (const [id, on] of [['switch', ' defaultSelected'], ['switch-off', '']]) {
    lib.codeFor(id, `<Switch${on}{class}>\n  <Switch.Content>\n    <Switch.Control>\n      <Switch.Thumb />\n    </Switch.Control>\n    {text:${id}-label}\n  </Switch.Content>\n</Switch>`, hero('Switch'));
  }
  lib.codeFor('avatar', '<Avatar{class}>\n  <Avatar.Fallback>{text:avatar-initials}</Avatar.Fallback>\n</Avatar>', hero('Avatar'));
  lib.codeFor('avatar-accent', '<Avatar color="accent"{class}>\n  <Avatar.Fallback>{text:avatar-accent-initials}</Avatar.Fallback>\n</Avatar>', hero('Avatar'));
  lib.codeFor('avatar-group', '<div{class:flex -space-x-2.5}>{children:.}</div>', {});
  lib.codeFor('kbd', '<Kbd{class}>\n  <Kbd.Abbr title="Command">⌘</Kbd.Abbr>\n  <Kbd.Content>{text:kbd-key}</Kbd.Content>\n</Kbd>', hero('Kbd'));
  lib.codeFor('separator', '<Separator{class} />', hero('Separator'));
  for (const [id, status] of [['alert', 'accent'], ['alert-success', 'success'], ['alert-danger', 'danger']]) {
    lib.codeFor(id, `<Alert status="${status}"{class}>\n  <Alert.Indicator />\n  <Alert.Content>\n    <Alert.Title>{text:${id}-title}</Alert.Title>\n    <Alert.Description>{text:${id}-description}</Alert.Description>\n  </Alert.Content>\n</Alert>`, hero('Alert'));
  }
  lib.codeFor('card', '<Card{class}>\n  {node:card-media}\n  <Card.Header>\n    <Card.Title>{text:card-title}</Card.Title>\n    <Card.Description>{text:card-description}</Card.Description>\n  </Card.Header>\n  <Card.Footer{layout:card-footer}>{children:card-footer}</Card.Footer>\n</Card>', hero('Card'));
  lib.codeFor('tabs', '<Tabs{class}>\n  <Tabs.ListContainer>\n    <Tabs.List aria-label="Tabs">\n      <Tabs.Tab id="{slug:tabs-1-label}">{text:tabs-1-label}<Tabs.Indicator /></Tabs.Tab>\n      <Tabs.Tab id="{slug:tabs-2-label}">{text:tabs-2-label}<Tabs.Indicator /></Tabs.Tab>\n      <Tabs.Tab id="{slug:tabs-3-label}">{text:tabs-3-label}<Tabs.Indicator /></Tabs.Tab>\n    </Tabs.List>\n  </Tabs.ListContainer>\n</Tabs>', hero('Tabs'));
  lib.codeFor('progress', '<ProgressBar aria-label="{attr:progress-label}" value={40}{class}>\n  <Label>{text:progress-label}</Label>\n  <ProgressBar.Output />\n  <ProgressBar.Track>\n    <ProgressBar.Fill />\n  </ProgressBar.Track>\n</ProgressBar>', hero('Label', 'ProgressBar'));
  lib.codeFor('slider', '<Slider defaultValue={60}{class}>\n  <Label>{text:slider-label}</Label>\n  <Slider.Output />\n  <Slider.Track>\n    <Slider.Fill />\n    <Slider.Thumb />\n  </Slider.Track>\n</Slider>', hero('Label', 'Slider'));
}
