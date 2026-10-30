import { useEditor, type Lang } from './store.ts';

const en = {
  layers: 'Layers', components: 'Components', variables: 'Variables', activity: 'Activity',
  move: 'Move', hand: 'Hand', frame: 'Frame', rectangle: 'Rectangle', ellipse: 'Ellipse', polygon: 'Polygon', iconTool: 'Icon', text: 'Text', note: 'Note',
  align: 'Align', theme: 'Theme', copyPng: 'Copy as PNG', copyHtml: 'Copy as HTML', copyTailwind: 'Copy as HTML (Tailwind)', saveAs: 'Save a copy as…',
  undo: 'Undo', redo: 'Redo', export: 'Export', zoomToFit: 'Zoom to fit',
  noSelection: 'Select a layer to see its properties.', mixed: 'Mixed',
  position: 'Position', size: 'Size', layout: 'Layout', appearance: 'Appearance', fill: 'Fill', stroke: 'Stroke', effects: 'Effects',
  typography: 'Typography', icon: 'Icon', component: 'Component', instance: 'Instance of',
  horizontal: 'Horizontal', vertical: 'Vertical', free: 'Free', gap: 'Gap', padding: 'Padding', clip: 'Clip content',
  opacity: 'Opacity', radius: 'Radius', rotation: 'Rotation', fit: 'Fit', fillContainer: 'Fill', fixed: 'Fixed',
  noComponents: 'No components yet. Make one with Ctrl/Cmd+Alt+K or "Make component" on a frame.',
  noVariables: 'No variables. Agents create them with SetVariables; values show here.',
  noActivity: 'Changes by you and by agents appear here.', agent: 'Agent', you: 'You',
  connecting: 'Connecting to nib…', disconnected: 'Disconnected from nib. Reconnecting…',
  openTitle: 'Open a .pen file', openHint: 'Absolute path of a .pen file (a missing file is created)', open: 'Open',
  openDocs: 'Open in nib', makeComponent: 'Make component', detach: 'Go to component', hidden: 'Hidden',
  shortcuts: 'Shortcuts', language: '中文', loading: 'Rendering…',
  problems: 'Problems', noProblems: 'No problems found.', palette: 'Search layers and commands…', exportAs: 'Export', exportButton: 'Export selection',
  copy: 'Copy', cut: 'Cut', paste: 'Paste', duplicate: 'Duplicate', delete: 'Delete', frameSelection: 'Frame selection', fitAll: 'Zoom to fit all', fitSelection: 'Zoom to selection', togglePanel: 'Toggle left panel', toggleActivity: 'Toggle activity', switchLanguage: 'Switch language',
};
const zh: typeof en = {
  layers: '图层', components: '组件', variables: '变量', activity: '动态',
  move: '移动', hand: '抓手', frame: '画框', rectangle: '矩形', ellipse: '椭圆', polygon: '多边形', iconTool: '图标', text: '文本', note: '便签',
  align: '对齐', theme: '主题', copyPng: '复制为 PNG', copyHtml: '复制为 HTML', copyTailwind: '复制为 HTML（Tailwind）', saveAs: '另存副本…',
  undo: '撤销', redo: '重做', export: '导出', zoomToFit: '缩放到全部',
  noSelection: '选择一个图层以查看属性。', mixed: '多个值',
  position: '位置', size: '尺寸', layout: '布局', appearance: '外观', fill: '填充', stroke: '描边', effects: '效果',
  typography: '文字', icon: '图标', component: '组件', instance: '实例来自',
  horizontal: '横向', vertical: '纵向', free: '自由', gap: '间距', padding: '内边距', clip: '裁剪内容',
  opacity: '不透明度', radius: '圆角', rotation: '旋转', fit: '适应内容', fillContainer: '填满', fixed: '固定',
  noComponents: '还没有组件。在画框上用 Ctrl/Cmd+Alt+K 或“创建组件”。',
  noVariables: '没有变量。智能体用 SetVariables 创建，取值显示在这里。',
  noActivity: '你和智能体做的修改会显示在这里。', agent: '智能体', you: '你',
  connecting: '正在连接 nib…', disconnected: '与 nib 断开，正在重连…',
  openTitle: '打开 .pen 文件', openHint: '.pen 文件的绝对路径（不存在会新建）', open: '打开',
  openDocs: 'nib 中已打开', makeComponent: '创建组件', detach: '前往组件', hidden: '已隐藏',
  shortcuts: '快捷键', language: 'English', loading: '渲染中…',
  problems: '问题', noProblems: '没有发现问题。', palette: '搜索图层和命令…', exportAs: '导出', exportButton: '导出所选',
  copy: '复制', cut: '剪切', paste: '粘贴', duplicate: '创建副本', delete: '删除', frameSelection: '用画框包裹', fitAll: '缩放到全部', fitSelection: '缩放到所选', togglePanel: '切换左侧面板', toggleActivity: '切换动态', switchLanguage: '切换语言',
};

export type Strings = typeof en;
const TABLES: Record<Lang, Strings> = { en, zh };

export function useT(): Strings {
  return TABLES[useEditor((s) => s.lang)];
}
