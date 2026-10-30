// nib's Ant Design library: Ant Design v5 (MIT) components and its default and dark themes, drawn as .pen
// components. Sizes follow antd's design tokens (control height 32, radius 6, font size 14).
import { col, ellipse, frame, icon, Library, rect, ref, row, show, text, themedColors, type N } from './kit.ts';

const light = {
  primary: '#1677FF', 'primary-hover': '#4096FF', 'primary-bg': '#E6F4FF', 'primary-border': '#91CAFF',
  success: '#52C41A', 'success-bg': '#F6FFED', 'success-border': '#B7EB8F',
  warning: '#FAAD14', 'warning-bg': '#FFFBE6', 'warning-border': '#FFE58F',
  error: '#FF4D4F', 'error-bg': '#FFF2F0', 'error-border': '#FFCCC7',
  text: '#000000E0', 'text-secondary': '#000000A6', 'text-tertiary': '#00000073', 'text-quaternary': '#00000040', 'text-light': '#FFFFFF',
  border: '#D9D9D9', 'border-secondary': '#F0F0F0',
  fill: '#00000026', 'fill-secondary': '#0000000F', 'fill-tertiary': '#0000000A', 'fill-quaternary': '#00000005',
  'bg-container': '#FFFFFF', 'bg-elevated': '#FFFFFF', 'bg-layout': '#F5F5F5', 'bg-spotlight': '#000000D9', 'table-header': '#FAFAFA',
  'shadow-1': '#00000014', 'shadow-2': '#0000001F', 'shadow-3': '#0000000D', 'shadow-button': '#0591FF1A',
};
const dark = {
  primary: '#1668DC', 'primary-hover': '#3C89E8', 'primary-bg': '#111A2C', 'primary-border': '#15325B',
  success: '#49AA19', 'success-bg': '#162312', 'success-border': '#274916',
  warning: '#D89614', 'warning-bg': '#2B2111', 'warning-border': '#594214',
  error: '#DC4446', 'error-bg': '#2C1618', 'error-border': '#5B2526',
  text: '#FFFFFFD9', 'text-secondary': '#FFFFFFA6', 'text-tertiary': '#FFFFFF73', 'text-quaternary': '#FFFFFF40', 'text-light': '#FFFFFF',
  border: '#424242', 'border-secondary': '#303030',
  fill: '#FFFFFF2E', 'fill-secondary': '#FFFFFF1F', 'fill-tertiary': '#FFFFFF14', 'fill-quaternary': '#FFFFFF0A',
  'bg-container': '#141414', 'bg-elevated': '#1F1F1F', 'bg-layout': '#000000', 'bg-spotlight': '#424242', 'table-header': '#1D1D1D',
  'shadow-1': '#00000052', 'shadow-2': '#00000070', 'shadow-3': '#00000033', 'shadow-button': '#00000000',
};

const shadow = (x: number, y: number, blur: number, spread: number, color: string) => ({ type: 'shadow', offset: { x, y }, blur, spread, color });
/** antd's boxShadow, for popups (dropdowns, modals, messages). */
const popup = [shadow(0, 6, 16, 0, '$shadow-1'), shadow(0, 3, 6, -4, '$shadow-2'), shadow(0, 9, 28, 8, '$shadow-3')];
const card = [shadow(0, 1, 2, 0, '$shadow-3'), shadow(0, 1, 6, -1, '$shadow-3')];

const font = '$font-sans';
const t = (content: string, props: N = {}) => text(content, { fontFamily: font, fontSize: 14, lineHeight: 1.5714, fill: '$text', ...props });
const sub = (content: string, props: N = {}) => t(content, { fill: '$text-secondary', ...props });
const heading = (content: string) => t(content, { fontSize: 24, fontWeight: '600', lineHeight: 1.33 });
const caption = (content: string) => t(content, { fontSize: 13, fill: '$text-tertiary' });
const group = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 16, alignItems: 'center' }, ...items));
const tall = (label: string, ...items: N[]) => col({ gap: 12 }, caption(label), row({ gap: 24, alignItems: 'start' }, ...items));

export const meta = {
  id: 'antd',
  name: 'Ant Design',
  summary: {
    en: 'Ant Design v5 for dense admin and data apps: buttons, forms, tags, tables, steps, menus and an admin dashboard to start from.',
    zh: '适合中后台与数据应用的 Ant Design v5：按钮、表单、标签、表格、步骤条、菜单，以及一个可直接起步的管理后台。',
  },
  basedOn: 'Ant Design v5 (default and dark algorithms)',
  license: 'MIT',
  homepage: 'https://ant.design',
  /** Which variables follow a brand's color, radius and font (see the daemon's brand.ts). */
  brand: { anchor: 'primary', radius: 'radius', font: 'font-sans', vars: { 'primary-hover': 'recolor', 'primary-bg': 'recolor', 'primary-border': 'recolor' } },
};

export function antd(): Library {
  const lib = new Library('antd', { Mode: ['Light', 'Dark'] });
  Object.assign(lib.variables, themedColors(light, dark), {
    'font-sans': { type: 'string', value: 'Inter' },
    radius: { type: 'number', value: 6 }, 'radius-lg': { type: 'number', value: 8 }, 'radius-sm': { type: 'number', value: 4 },
  });

  // Buttons --------------------------------------------------------------------------------------
  const button = (id: string, name: string, look: N, ink: string, size: 'small' | 'middle' | 'large' = 'middle') => lib.component(id, name, row({
    height: size === 'small' ? 24 : size === 'large' ? 40 : 32, padding: [0, size === 'small' ? 7 : size === 'large' ? 15 : 15], gap: 8,
    alignItems: 'center', justifyContent: 'center', cornerRadius: size === 'large' ? '$radius-lg' : size === 'small' ? '$radius-sm' : '$radius', ...look,
  }, t('Button', { id: `${id}-label`, fill: ink, ...(size === 'large' ? { fontSize: 16, lineHeight: 1.5 } : {}) })));
  const primary = { fill: '$primary', effect: shadow(0, 2, 0, 0, '$shadow-button') };
  button('button', 'Button / Primary', primary, '$text-light');
  button('button-default', 'Button / Default', { fill: '$bg-container', stroke: '$border', strokeWidth: 1 }, '$text');
  button('button-text', 'Button / Text', {}, '$text');
  button('button-link', 'Button / Link', {}, '$primary');
  button('button-danger', 'Button / Danger', { fill: '$error' }, '$text-light');
  button('button-danger-default', 'Button / Danger Default', { fill: '$bg-container', stroke: '$error', strokeWidth: 1 }, '$error');
  button('button-small', 'Button / Small', primary, '$text-light', 'small');
  button('button-large', 'Button / Large', primary, '$text-light', 'large');
  lib.component('button-icon', 'Button / Icon', row({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius', fill: primary.fill, effect: primary.effect },
    icon('search', { id: 'button-icon-glyph', fill: '$text-light' })));
  lib.component('button-with-icon', 'Button / With Icon', row({ height: 32, padding: [0, 15], gap: 8, alignItems: 'center', cornerRadius: '$radius', ...primary },
    icon('download', { id: 'button-with-icon-glyph', fill: '$text-light' }), t('Download', { id: 'button-with-icon-label', fill: '$text-light' })));

  // Data entry -----------------------------------------------------------------------------------
  const field = { height: 32, padding: [0, 11], gap: 4, alignItems: 'center', cornerRadius: '$radius', fill: '$bg-container', stroke: '$border', strokeWidth: 1 };
  lib.component('input', 'Input', row({ ...field, width: 240 }, t('Basic usage', { id: 'input-text', fill: '$text-quaternary', width: 'fill_container' })));
  lib.component('input-filled', 'Input / Filled', row({ ...field, width: 240 }, t('ant.design', { id: 'input-filled-text', width: 'fill_container' })));
  lib.component('input-prefix', 'Input / With Prefix', row({ ...field, width: 240, gap: 8 }, icon('user', { id: 'input-prefix-icon', width: 14, height: 14, fill: '$text-quaternary' }), t('Enter your username', { id: 'input-prefix-text', fill: '$text-quaternary', width: 'fill_container' })));
  lib.component('input-search', 'Input / Search', row({ width: 280 },
    row({ ...field, width: 'fill_container', cornerRadius: [6, 0, 0, 6] }, t('input search text', { id: 'input-search-text', fill: '$text-quaternary', width: 'fill_container' })),
    row({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', cornerRadius: [0, 6, 6, 0], fill: '$primary' }, icon('search', { width: 14, height: 14, fill: '$text-light' }))));
  lib.component('textarea', 'TextArea', row({ ...field, height: 76, width: 240, alignItems: 'start', padding: [4, 11] }, t('Controlled autosize', { id: 'textarea-text', fill: '$text-quaternary', width: 'fill_container' })));
  lib.component('select', 'Select', row({ ...field, width: 200, justifyContent: 'space_between' }, t('Select a person', { id: 'select-text', fill: '$text-quaternary' }), icon('chevron-down', { width: 12, height: 12, fill: '$text-quaternary' })));
  lib.component('form-item', 'Form Item', col({ gap: 8, width: 280 },
    row({ gap: 4, alignItems: 'center' }, t('*', { fill: '$error' }), t('Username', { id: 'form-item-label' })),
    ref('input', { id: 'form-item-input', width: 'fill_container' }, { 'input-text': { content: 'Please input your username' } }),
    t('Must be 4 to 16 characters.', { id: 'form-item-help', fill: '$text-tertiary' })));
  const box = (on: boolean): N => frame({ width: 16, height: 16, cornerRadius: 4, layout: 'horizontal', alignItems: 'center', justifyContent: 'center',
    ...(on ? { fill: '$primary' } : { fill: '$bg-container', stroke: '$border', strokeWidth: 1 }) }, ...(on ? [icon('check', { width: 12, height: 12, fill: '$text-light' })] : []));
  lib.component('checkbox', 'Checkbox / Checked', row({ gap: 8, alignItems: 'center' }, box(true), t('Remember me', { id: 'checkbox-label' })));
  lib.component('checkbox-off', 'Checkbox / Unchecked', row({ gap: 8, alignItems: 'center' }, box(false), t('Checkbox', { id: 'checkbox-off-label' })));
  const radio = (on: boolean): N => frame({ width: 16, height: 16, cornerRadius: 8, layout: 'horizontal', alignItems: 'center', justifyContent: 'center',
    ...(on ? { fill: '$primary' } : { fill: '$bg-container', stroke: '$border', strokeWidth: 1 }) }, ...(on ? [ellipse({ width: 6, height: 6, fill: '$text-light' })] : []));
  lib.component('radio', 'Radio / Checked', row({ gap: 8, alignItems: 'center' }, radio(true), t('Option A', { id: 'radio-label' })));
  lib.component('radio-off', 'Radio / Unchecked', row({ gap: 8, alignItems: 'center' }, radio(false), t('Option B', { id: 'radio-off-label' })));
  const sw = (on: boolean): N => frame({ width: 44, height: 22, cornerRadius: 11, layout: 'horizontal', alignItems: 'center', justifyContent: on ? 'end' : 'start', padding: 2, fill: on ? '$primary' : '$text-quaternary' },
    ellipse({ width: 18, height: 18, fill: '#FFFFFF', effect: shadow(0, 2, 4, 0, '#00230B33') }));
  lib.component('switch', 'Switch / On', row({ gap: 8, alignItems: 'center' }, sw(true), t('Notifications', { id: 'switch-label' })));
  lib.component('switch-off', 'Switch / Off', row({ gap: 8, alignItems: 'center' }, sw(false), t('Auto update', { id: 'switch-off-label' })));
  lib.component('slider', 'Slider', frame({ width: 240, height: 12, layout: 'none' },
    rect({ x: 0, y: 4, width: 240, height: 4, cornerRadius: 2, fill: '$fill-secondary' }),
    rect({ id: 'slider-track', x: 0, y: 4, width: 96, height: 4, cornerRadius: 2, fill: '$primary-border' }),
    ellipse({ id: 'slider-handle', x: 90, y: 1, width: 10, height: 10, fill: '$bg-container', stroke: '$primary-border', strokeWidth: 2, strokeAlignment: 'outer' })));

  // Data display ---------------------------------------------------------------------------------
  const tag = (id: string, name: string, bg: string, border: string, ink: string, label: string) => lib.component(id, name, row({ height: 22, padding: [0, 7], alignItems: 'center', cornerRadius: '$radius-sm', fill: bg, stroke: border, strokeWidth: 1 },
    t(label, { id: `${id}-label`, fontSize: 12, lineHeight: 1.67, fill: ink })));
  tag('tag', 'Tag / Default', '$fill-quaternary', '$border', '$text', 'Tag');
  tag('tag-success', 'Tag / Success', '$success-bg', '$success-border', '$success', 'success');
  tag('tag-processing', 'Tag / Processing', '$primary-bg', '$primary-border', '$primary', 'processing');
  tag('tag-warning', 'Tag / Warning', '$warning-bg', '$warning-border', '$warning', 'warning');
  tag('tag-error', 'Tag / Error', '$error-bg', '$error-border', '$error', 'error');
  lib.component('badge', 'Badge', row({ height: 20, padding: [0, 6], cornerRadius: 10, fill: '$error', alignItems: 'center', justifyContent: 'center', stroke: '$bg-container', strokeWidth: 1, strokeAlignment: 'outer' },
    t('5', { id: 'badge-count', fontSize: 12, lineHeight: 1.67, fill: '$text-light' })));
  lib.component('avatar', 'Avatar', row({ width: 32, height: 32, cornerRadius: 16, fill: '$text-quaternary', alignItems: 'center', justifyContent: 'center', clip: true },
    t('U', { id: 'avatar-text', fill: '$text-light' })));
  const alert = (id: string, name: string, kind: 'success' | 'primary' | 'warning' | 'error', glyph: string, msg: string) => lib.component(id, name, row({ width: 420, padding: [8, 12], gap: 8, alignItems: 'center', cornerRadius: '$radius-lg', fill: `$${kind}-bg`, stroke: `$${kind}-border`, strokeWidth: 1 },
    icon(glyph, { id: `${id}-icon`, width: 14, height: 14, fill: `$${kind}` }), t(msg, { id: `${id}-message`, width: 'fill_container' })));
  alert('alert-success', 'Alert / Success', 'success', 'circle-check', 'Success Tips');
  alert('alert-info', 'Alert / Info', 'primary', 'info', 'Informational Notes');
  alert('alert-warning', 'Alert / Warning', 'warning', 'circle-alert', 'Warning');
  alert('alert-error', 'Alert / Error', 'error', 'circle-x', 'Error');
  lib.component('card', 'Card', col({ width: 300, cornerRadius: '$radius-lg', fill: '$bg-container', stroke: '$border-secondary', strokeWidth: 1, clip: true },
    row({ id: 'card-head', height: 56, padding: [0, 24], alignItems: 'center', justifyContent: 'space_between', width: 'fill_container', stroke: '$border-secondary', strokeWidth: { bottom: 1 } },
      t('Card title', { id: 'card-title', fontSize: 16, fontWeight: '600', lineHeight: 1.5 }), t('More', { id: 'card-extra', fill: '$primary' })),
    col({ id: 'card-body', padding: 24, gap: 4, width: 'fill_container' }, t('Card content'), t('Card content'), t('Card content'))));
  lib.component('statistic', 'Statistic', col({ gap: 4 },
    sub('Active Users', { id: 'statistic-title' }),
    t('112,893', { id: 'statistic-value', fontSize: 24, lineHeight: 1.33 })));
  lib.component('progress', 'Progress', row({ width: 260, gap: 8, alignItems: 'center' },
    frame({ width: 'fill_container', height: 8, cornerRadius: 100, fill: '$fill-secondary', layout: 'none', clip: true }, rect({ id: 'progress-bar', x: 0, y: 0, width: 132, height: 8, cornerRadius: 100, fill: '$primary' })),
    t('60%', { id: 'progress-text' })));
  lib.component('divider', 'Divider', rect({ width: 320, height: 1, fill: '$border-secondary' }));
  lib.component('tooltip', 'Tooltip', row({ padding: [6, 8], cornerRadius: '$radius', fill: '$bg-spotlight', effect: popup }, t('prompt text', { id: 'tooltip-text', fill: '$text-light' })));
  const columns = ['Name', 'Age', 'Address', 'Tags'];
  const people: [string, string, string, string][] = [['John Brown', '32', 'New York No. 1 Lake Park', 'tag-success'], ['Jim Green', '42', 'London No. 1 Lake Park', 'tag-error'], ['Joe Black', '32', 'Sydney No. 1 Lake Park', 'tag-processing']];
  const tagText: Record<string, string> = { 'tag-success': 'nice', 'tag-error': 'loser', 'tag-processing': 'developer' };
  const cell = (child: N, w: N = { width: 'fill_container' }) => row({ ...w, padding: [16, 16], alignItems: 'center' }, child);
  lib.component('table', 'Table', col({ width: 640, cornerRadius: '$radius-lg', fill: '$bg-container', clip: true },
    row({ width: 'fill_container', fill: '$table-header', stroke: '$border-secondary', strokeWidth: { bottom: 1 } }, ...columns.map((c, i) => cell(t(c, { fontWeight: '600' }), i === 2 ? { width: 'fill_container' } : { width: i === 1 ? 80 : 150 }))),
    ...people.map(([name, age, addr, tg], r) => row({ id: `table-row-${r + 1}`, width: 'fill_container', stroke: '$border-secondary', strokeWidth: { bottom: 1 } },
      cell(t(name, { fill: '$primary' }), { width: 150 }), cell(t(age), { width: 80 }), cell(t(addr)), cell(ref(tg, {}, { [`${tg}-label`]: { content: tagText[tg] } }), { width: 150 })))));

  // Navigation -----------------------------------------------------------------------------------
  const tab = (id: string, label: string, on: boolean): N => col({ id, gap: 0, alignItems: 'center' },
    row({ padding: [12, 0] }, t(label, { id: `${id}-label`, fill: on ? '$primary' : '$text' })),
    rect({ width: 'fill_container', height: 2, fill: on ? '$primary' : '#00000000' }));
  lib.component('tabs', 'Tabs', row({ width: 400, gap: 32, stroke: '$border-secondary', strokeWidth: { bottom: 1 } }, tab('tabs-1', 'Tab 1', true), tab('tabs-2', 'Tab 2', false), tab('tabs-3', 'Tab 3', false)));
  lib.component('breadcrumb', 'Breadcrumb', row({ gap: 8, alignItems: 'center' },
    t('Home', { id: 'breadcrumb-1', fill: '$text-tertiary' }), t('/', { fill: '$text-tertiary' }), t('Application List', { id: 'breadcrumb-2', fill: '$text-tertiary' }), t('/', { fill: '$text-tertiary' }), t('An Application', { id: 'breadcrumb-3' })));
  const page = (n: string, on = false): N => row({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', cornerRadius: '$radius', ...(on ? { fill: '$bg-container', stroke: '$primary', strokeWidth: 1 } : {}) },
    t(n, { fill: on ? '$primary' : '$text', fontWeight: on ? '600' : '400' }));
  lib.component('pagination', 'Pagination', row({ gap: 8, alignItems: 'center' },
    row({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }, icon('chevron-left', { width: 12, height: 12, fill: '$text-quaternary' })),
    page('1'), page('2', true), page('3'), page('4'), page('5'),
    row({ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }, icon('chevron-right', { width: 12, height: 12, fill: '$text' }))));
  const step = (id: string, n: string, title: string, state: 'finish' | 'process' | 'wait', last = false): N => row({ id, gap: 8, alignItems: 'center', ...(last ? {} : { width: 'fill_container' }) },
    row({ width: 32, height: 32, cornerRadius: 16, alignItems: 'center', justifyContent: 'center', fill: state === 'finish' ? '$primary-bg' : state === 'process' ? '$primary' : '$fill-secondary' },
      state === 'finish' ? icon('check', { width: 16, height: 16, fill: '$primary' }) : t(n, { fill: state === 'process' ? '$text-light' : '$text-tertiary', fontSize: 16, lineHeight: 1.5 })),
    t(title, { id: `${id}-title`, fontSize: 16, lineHeight: 1.5, fill: state === 'wait' ? '$text-tertiary' : '$text' }),
    ...(last ? [] : [rect({ width: 'fill_container', height: 1, fill: state === 'finish' ? '$primary' : '$border-secondary' })]));
  lib.component('steps', 'Steps', row({ width: 640, gap: 16, alignItems: 'center' }, step('steps-1', '1', 'Finished', 'finish'), step('steps-2', '2', 'In Progress', 'process'), step('steps-3', '3', 'Waiting', 'wait', true)));
  const item = (glyph: string, label: string, on = false): N => row({ height: 40, padding: [0, 16, 0, 24], gap: 10, alignItems: 'center', width: 'fill_container', cornerRadius: '$radius-lg', ...(on ? { fill: '$primary-bg' } : {}) },
    icon(glyph, { width: 14, height: 14, fill: on ? '$primary' : '$text' }), t(label, { fill: on ? '$primary' : '$text' }));
  lib.component('menu', 'Menu', col({ width: 220, padding: 4, gap: 4, fill: '$bg-container', stroke: '$border-secondary', strokeWidth: { right: 1 } },
    item('layout-dashboard', 'Dashboard', true), item('users', 'Users'), item('file-text', 'Orders'), item('chart-column', 'Reports'), item('settings', 'Settings')));
  lib.component('dropdown', 'Dropdown Menu', col({ width: 180, padding: 4, cornerRadius: '$radius-lg', fill: '$bg-elevated', effect: popup },
    ...['1st menu item', '2nd menu item', '3rd menu item'].map((s, i) => row({ height: 32, padding: [5, 12], alignItems: 'center', cornerRadius: '$radius-sm', width: 'fill_container', ...(i === 0 ? { fill: '$fill-tertiary' } : {}) }, t(s))),
    row({ height: 32, padding: [5, 12], alignItems: 'center', width: 'fill_container' }, t('a danger item', { fill: '$error' }))));

  // Feedback -------------------------------------------------------------------------------------
  lib.component('modal', 'Modal', col({ width: 416, padding: [20, 24], gap: 12, cornerRadius: '$radius-lg', fill: '$bg-elevated', effect: popup },
    row({ width: 'fill_container', justifyContent: 'space_between', alignItems: 'center' }, t('Basic Modal', { id: 'modal-title', fontSize: 16, fontWeight: '600', lineHeight: 1.5 }), icon('x', { width: 16, height: 16, fill: '$text-tertiary' })),
    col({ gap: 4, width: 'fill_container' }, t('Some contents...', { id: 'modal-body' }), t('Some contents...')),
    row({ gap: 8, justifyContent: 'end', width: 'fill_container', padding: [12, 0, 0, 0] },
      ref('button-default', { id: 'modal-cancel' }, { 'button-default-label': { content: 'Cancel' } }), ref('button', { id: 'modal-ok' }, { 'button-label': { content: 'OK' } }))));
  lib.component('message', 'Message', row({ padding: [9, 12], gap: 8, alignItems: 'center', cornerRadius: '$radius-lg', fill: '$bg-elevated', effect: popup },
    icon('circle-check', { id: 'message-icon', width: 16, height: 16, fill: '$success' }), t('This is a success message', { id: 'message-text' })));

  // Boards ---------------------------------------------------------------------------------------
  lib.board('board-general', 'General', { fill: '$bg-layout' }, heading('General'),
    group('Buttons', show('button'), show('button-default'), show('button-text'), show('button-link'), show('button-danger'), show('button-danger-default')),
    group('Sizes and icons', show('button-small'), show('button-large'), show('button-icon'), show('button-with-icon')),
    group('Tags and badges', show('tag'), show('tag-success'), show('tag-processing'), show('tag-warning'), show('tag-error'), show('badge'), show('avatar'), show('tooltip')));
  lib.board('board-entry', 'Data entry', { fill: '$bg-layout' }, heading('Data entry'),
    tall('Inputs', show('input'), show('input-filled'), show('input-prefix'), show('input-search')),
    tall('More inputs', show('textarea'), show('select'), show('form-item')),
    group('Choices', show('checkbox'), show('checkbox-off'), show('radio'), show('radio-off'), show('switch'), show('switch-off')),
    group('Range', show('slider'), show('progress')));
  lib.board('board-display', 'Data display', { fill: '$bg-layout' }, heading('Data display'),
    tall('Alerts', col({ gap: 12 }, show('alert-success'), show('alert-info')), col({ gap: 12 }, show('alert-warning'), show('alert-error'))),
    tall('Cards', show('card'), show('statistic'), show('divider')),
    tall('Table', show('table')));
  lib.board('board-navigation', 'Navigation and feedback', { fill: '$bg-layout' }, heading('Navigation and feedback'),
    group('Tabs and breadcrumb', show('tabs'), show('breadcrumb')),
    group('Pagination', show('pagination')),
    tall('Steps', show('steps')),
    tall('Menus', show('menu'), show('dropdown')),
    tall('Feedback', show('modal'), show('message')));

  // The overview a new design starts from: an admin dashboard.
  const stat = (id: string, title: string, value: string, delta: string, up: boolean): N => col({ id, width: 'fill_container', padding: 24, gap: 8, cornerRadius: '$radius-lg', fill: '$bg-container', effect: card },
    ref('statistic', { id: `${id}-stat` }, { 'statistic-title': { content: title }, 'statistic-value': { content: value } }),
    row({ gap: 4, alignItems: 'center' }, icon(up ? 'trending-up' : 'trending-down', { width: 14, height: 14, fill: up ? '$success' : '$error' }), t(delta, { fill: up ? '$success' : '$error' }), sub('vs last week')));
  lib.board('overview', 'Overview', { width: 1440, height: 900, padding: 0, gap: 0, layout: 'horizontal', clip: true, fill: '$bg-layout' },
    col({ width: 220, height: 'fill_container', fill: '$bg-container', stroke: '$border-secondary', strokeWidth: { right: 1 } },
      row({ height: 64, padding: [0, 24], gap: 10, alignItems: 'center', width: 'fill_container' },
        row({ width: 28, height: 28, cornerRadius: 6, fill: '$primary', alignItems: 'center', justifyContent: 'center' }, icon('hexagon', { width: 16, height: 16, fill: '$text-light' })),
        t('Ant Admin', { fontSize: 16, fontWeight: '600', lineHeight: 1.5 })),
      ref('menu', { id: 'overview-menu', width: 'fill_container', height: 'fill_container', stroke: '#00000000' })),
    col({ width: 'fill_container', height: 'fill_container' },
      row({ width: 'fill_container', height: 64, padding: [0, 24], alignItems: 'center', justifyContent: 'space_between', fill: '$bg-container', stroke: '$border-secondary', strokeWidth: { bottom: 1 } },
        ref('input-search', { id: 'overview-search' }, { 'input-search-text': { content: 'Search orders' } }),
        row({ gap: 16, alignItems: 'center' }, icon('bell', { fill: '$text-secondary' }), ref('avatar', { id: 'overview-avatar' }, { 'avatar-text': { content: 'A' } }), t('Admin'))),
      col({ width: 'fill_container', height: 'fill_container', padding: 24, gap: 16 },
        ref('breadcrumb', { id: 'overview-breadcrumb' }, { 'breadcrumb-1': { content: 'Home' }, 'breadcrumb-2': { content: 'Dashboard' }, 'breadcrumb-3': { content: 'Analysis' } }),
        row({ width: 'fill_container', gap: 16 },
          stat('overview-stat-1', 'Total Sales', '¥ 126,560', '12%', true), stat('overview-stat-2', 'Visits', '8,846', '5%', true),
          stat('overview-stat-3', 'Payments', '6,560', '3%', false), stat('overview-stat-4', 'Operational Effect', '78%', '1%', true)),
        row({ width: 'fill_container', gap: 16, height: 'fill_container', alignItems: 'start' },
          col({ width: 'fill_container', padding: 24, gap: 16, cornerRadius: '$radius-lg', fill: '$bg-container', effect: card },
            row({ width: 'fill_container', justifyContent: 'space_between', alignItems: 'center' }, t('Recent Orders', { fontSize: 16, fontWeight: '600', lineHeight: 1.5 }), ref('button-with-icon', { id: 'overview-export' }, { 'button-with-icon-label': { content: 'Export' } })),
            ref('table', { id: 'overview-table', width: 'fill_container' }),
            row({ width: 'fill_container', justifyContent: 'end' }, ref('pagination', { id: 'overview-pagination' }))),
          col({ width: 360, padding: 24, gap: 16, cornerRadius: '$radius-lg', fill: '$bg-container', effect: card },
            t('Quick Setup', { fontSize: 16, fontWeight: '600', lineHeight: 1.5 }),
            ref('steps', { id: 'overview-steps', width: 'fill_container' }, { 'steps-1-title': { content: 'Account' }, 'steps-2-title': { content: 'Team' }, 'steps-3-title': { content: 'Done' } }),
            ref('form-item', { id: 'overview-form', width: 'fill_container' }, { 'form-item-label': { content: 'Team name' }, 'form-item-input/input-text': { content: 'Ant Design Team' }, 'form-item-help': { content: 'Shown to everyone you invite.' } }),
            ref('switch', { id: 'overview-switch' }, { 'switch-label': { content: 'Email me weekly reports' } }),
            row({ width: 'fill_container', gap: 8, justifyContent: 'end' }, ref('button-default', { id: 'overview-cancel' }, { 'button-default-label': { content: 'Cancel' } }), ref('button', { id: 'overview-save' }, { 'button-label': { content: 'Save' } })))))));
  code(lib);
  return lib;
}

export const codeMeta = { library: 'Ant Design', setup: 'npm install antd lucide-react (wrap the app in ConfigProvider for the dark algorithm)', inherited: ['font-sans'] };

/** Ant Design components as their code: https://ant.design/components/overview. */
function code(lib: Library) {
  const antd = (...names: string[]) => Object.fromEntries(names.map((n) => [n, 'antd']));
  for (const [id, props] of [['button', ' type="primary"'], ['button-default', ''], ['button-text', ' type="text"'], ['button-link', ' type="link"'], ['button-danger', ' type="primary" danger'],
    ['button-danger-default', ' danger'], ['button-small', ' type="primary" size="small"'], ['button-large', ' type="primary" size="large"']]) {
    lib.codeFor(id, `<Button${props}{class}>{text:${id}-label}</Button>`, antd('Button'));
  }
  lib.codeFor('button-icon', '<Button type="primary" icon={ {icon:button-icon-glyph} }{class} />', antd('Button'));
  lib.codeFor('button-with-icon', '<Button type="primary" icon={ {icon:button-with-icon-glyph} }{class}>{text:button-with-icon-label}</Button>', antd('Button'));
  lib.codeFor('input', '<Input placeholder="{attr:input-text}"{class} />', antd('Input'));
  lib.codeFor('input-filled', '<Input defaultValue="{attr:input-filled-text}"{class} />', antd('Input'));
  lib.codeFor('input-prefix', '<Input prefix={ {icon:input-prefix-icon} } placeholder="{attr:input-prefix-text}"{class} />', antd('Input'));
  lib.codeFor('input-search', '<Input.Search placeholder="{attr:input-search-text}" enterButton{class} />', antd('Input'));
  lib.codeFor('textarea', '<Input.TextArea rows={3} placeholder="{attr:textarea-text}"{class} />', antd('Input'));
  lib.codeFor('select', '<Select placeholder="{attr:select-text}" options={[]}{class} />', antd('Select'));
  lib.codeFor('form-item', '<Form layout="vertical"{class}>\n  <Form.Item label="{attr:form-item-label}" required extra="{attr:form-item-help}">\n    <Input placeholder="{attr:form-item-input/input-text}" />\n  </Form.Item>\n</Form>', antd('Form', 'Input'));
  lib.codeFor('checkbox', '<Checkbox defaultChecked{class}>{text:checkbox-label}</Checkbox>', antd('Checkbox'));
  lib.codeFor('checkbox-off', '<Checkbox{class}>{text:checkbox-off-label}</Checkbox>', antd('Checkbox'));
  lib.codeFor('radio', '<Radio defaultChecked{class}>{text:radio-label}</Radio>', antd('Radio'));
  lib.codeFor('radio-off', '<Radio{class}>{text:radio-off-label}</Radio>', antd('Radio'));
  lib.codeFor('switch', '<Space{class}>\n  <Switch defaultChecked />\n  {text:switch-label}\n</Space>', antd('Space', 'Switch'));
  lib.codeFor('switch-off', '<Space{class}>\n  <Switch />\n  {text:switch-off-label}\n</Space>', antd('Space', 'Switch'));
  lib.codeFor('slider', '<Slider defaultValue={40}{class} />', antd('Slider'));
  for (const [id, color] of [['tag', ''], ['tag-success', ' color="success"'], ['tag-processing', ' color="processing"'], ['tag-warning', ' color="warning"'], ['tag-error', ' color="error"']]) {
    lib.codeFor(id, `<Tag${color}{class}>{text:${id}-label}</Tag>`, antd('Tag'));
  }
  lib.codeFor('badge', '<Badge count={ {text:badge-count} }{class} />', antd('Badge'));
  lib.codeFor('avatar', '<Avatar{class}>{text:avatar-text}</Avatar>', antd('Avatar'));
  for (const [id, type] of [['alert-success', 'success'], ['alert-info', 'info'], ['alert-warning', 'warning'], ['alert-error', 'error']]) {
    lib.codeFor(id, `<Alert message="{attr:${id}-message}" type="${type}" showIcon{class} />`, antd('Alert'));
  }
  lib.codeFor('card', '<Card title="{attr:card-title}" extra={<a href="#">{text:card-extra}</a>}{class}>{children:card-body}</Card>', antd('Card'));
  lib.codeFor('statistic', '<Statistic title="{attr:statistic-title}" value="{attr:statistic-value}"{class} />', antd('Statistic'));
  lib.codeFor('progress', '<Progress percent={60}{class} />', antd('Progress'));
  lib.codeFor('divider', '<Divider{class} />', antd('Divider'));
  lib.codeFor('tabs', '<Tabs defaultActiveKey="1" items={[{ key: "1", label: "{attr:tabs-1-label}" }, { key: "2", label: "{attr:tabs-2-label}" }, { key: "3", label: "{attr:tabs-3-label}" }]}{class} />', antd('Tabs'));
  lib.codeFor('breadcrumb', '<Breadcrumb items={[{ title: "{attr:breadcrumb-1}" }, { title: "{attr:breadcrumb-2}" }, { title: "{attr:breadcrumb-3}" }]}{class} />', antd('Breadcrumb'));
  lib.codeFor('pagination', '<Pagination defaultCurrent={2} total={50}{class} />', antd('Pagination'));
  lib.codeFor('steps', '<Steps current={1} items={[{ title: "{attr:steps-1-title}" }, { title: "{attr:steps-2-title}" }, { title: "{attr:steps-3-title}" }]}{class} />', antd('Steps'));
}
