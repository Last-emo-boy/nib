// Types for the .pen document format (pen.dev schema 2.x).

/** `$name` reference to a document variable. */
export type VarRef = string;
export type Num = number | VarRef;
export type Bool = boolean | VarRef;
export type Str = string | VarRef;
/** `#RGB`, `#RRGGBB`, `#RRGGBBAA`, or a variable reference. */
export type Color = string;

/** Theme axis name -> axis value, e.g. `{ mode: 'dark' }`. */
export type Theme = Record<string, string>;

/** A number, a variable, or `fit_content` / `fill_container` with an optional `(fallback)`. */
export type Size = number | string;

export type BlendMode =
  | 'normal' | 'darken' | 'multiply' | 'linearBurn' | 'colorBurn' | 'light' | 'screen'
  | 'linearDodge' | 'colorDodge' | 'overlay' | 'softLight' | 'hardLight' | 'difference'
  | 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity';

interface FillBase { enabled?: Bool; blendMode?: BlendMode }

export interface ColorFill extends FillBase { type: 'color'; color: Color }

export interface GradientStop { color: Color; position: Num }

export interface GradientFill extends FillBase {
  type: 'gradient';
  gradientType?: 'linear' | 'radial' | 'angular';
  opacity?: Num;
  /** Normalized to the node box. Default 0.5, 0.5. */
  center?: { x?: number; y?: number };
  /** Normalized to the node box. Default 1, 1. */
  size?: { width?: Num; height?: Num };
  /** Degrees counter-clockwise; 0 points up. */
  rotation?: Num;
  colors?: GradientStop[];
}

/** [a, b, c, d, tx, ty] */
export type Affine = [number, number, number, number, number, number];

export interface ImageFill extends FillBase {
  type: 'image';
  opacity?: Num;
  /** Relative to the .pen file, or an http(s) URL. */
  url?: string;
  /** Default 'cover'. Older files write 'fill' (= cover) and 'fit' (= contain). */
  mode?: 'cover' | 'contain' | 'stretch' | 'fill' | 'fit';
  transform?: Affine;
}

export interface ShaderFill extends FillBase {
  type: 'shader';
  opacity?: Num;
  url: string;
  uniforms?: Record<string, number | boolean | string | number[]>;
}

export interface MeshPoint {
  position: [number, number];
  leftHandle?: [number, number];
  rightHandle?: [number, number];
  topHandle?: [number, number];
  bottomHandle?: [number, number];
}

export interface MeshGradientFill extends FillBase {
  type: 'mesh_gradient';
  opacity?: Num;
  columns?: number;
  rows?: number;
  colors?: Color[];
  points?: ([number, number] | MeshPoint)[];
}

export type Fill = Color | ColorFill | GradientFill | ImageFill | ShaderFill | MeshGradientFill;
export type Fills = Fill | Fill[];

export type StrokeWidth = Num | { top?: Num; right?: Num; bottom?: Num; left?: Num };

export type Effect =
  | { type: 'blur'; enabled?: Bool; radius?: Num }
  | { type: 'background_blur'; enabled?: Bool; radius?: Num }
  | {
      type: 'shadow';
      enabled?: Bool;
      shadowType?: 'inner' | 'outer';
      offset?: { x: Num; y: Num };
      blur?: Num;
      spread?: Num;
      color?: Color;
      blendMode?: BlendMode;
    }
  | { type: 'shader'; enabled?: Bool; url: string; uniforms?: Record<string, unknown> };
export type Effects = Effect | Effect[];

export type CornerRadius = Num | [Num, Num, Num, Num];
export type Padding = Num | [Num, Num] | [Num, Num, Num, Num];

interface EntityProps {
  /** Unique, must not contain '/'. */
  id: string;
  name?: string;
  context?: string;
  reusable?: boolean;
  theme?: Theme;
  enabled?: Bool;
  opacity?: Num;
  flipX?: Bool;
  flipY?: Bool;
  layoutPosition?: 'auto' | 'absolute';
  metadata?: { type: string; [key: string]: unknown };
  /** Degrees counter-clockwise around the top-left corner. */
  rotation?: Num;
  x?: number;
  y?: number;
}

interface SizeProps { width?: Size; height?: Size }

interface StrokeProps {
  stroke?: Fills;
  strokeWidth?: StrokeWidth;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'miter' | 'bevel' | 'round';
  strokeAlignment?: 'inner' | 'center' | 'outer';
}

interface GraphicsProps extends StrokeProps { fill?: Fills; effect?: Effects }

export interface TextStyleProps {
  fontFamily?: Str;
  fontSize?: Num;
  fontWeight?: Str;
  letterSpacing?: Num;
  fontStyle?: Str;
  underline?: Bool;
  /** Multiple of fontSize. */
  lineHeight?: Num;
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  textAlignVertical?: 'top' | 'middle' | 'bottom';
  strikethrough?: Bool;
  href?: string;
}

export interface LayoutProps {
  layout?: 'none' | 'vertical' | 'horizontal';
  gap?: Num;
  layoutIncludeStroke?: boolean;
  padding?: Padding;
  justifyContent?: 'start' | 'center' | 'end' | 'space_between' | 'space_around';
  alignItems?: 'start' | 'center' | 'end';
}

export interface FrameNode extends EntityProps, SizeProps, GraphicsProps, LayoutProps {
  type: 'frame';
  cornerRadius?: CornerRadius;
  clip?: Bool;
  placeholder?: boolean;
  slot?: false | string[];
  children?: Node[];
}

export interface GroupNode extends EntityProps {
  type: 'group';
  effect?: Effects;
  children?: Node[];
}

export interface RectangleNode extends EntityProps, SizeProps, GraphicsProps {
  type: 'rectangle';
  cornerRadius?: CornerRadius;
}

export interface EllipseNode extends EntityProps, SizeProps, GraphicsProps {
  type: 'ellipse';
  innerRadius?: Num;
  startAngle?: Num;
  sweepAngle?: Num;
}

export interface PolygonNode extends EntityProps, SizeProps, GraphicsProps {
  type: 'polygon';
  polygonCount?: Num;
  cornerRadius?: Num;
}

export interface PathNode extends EntityProps, SizeProps, GraphicsProps {
  type: 'path';
  fillRule?: 'nonzero' | 'evenodd';
  geometry?: string;
  viewBox?: [number, number, number, number];
}

export interface TextNode extends EntityProps, SizeProps, GraphicsProps, TextStyleProps {
  type: 'text';
  content?: Str;
  textGrowth?: 'auto' | 'fixed-width' | 'fixed-width-height';
}

export interface NoteNode extends EntityProps, SizeProps, TextStyleProps { type: 'note'; content?: Str }
export interface ContextNode extends EntityProps, SizeProps, TextStyleProps { type: 'context'; content?: Str }
export interface PromptNode extends EntityProps, SizeProps, TextStyleProps { type: 'prompt'; content?: Str; model?: Str }

export interface IconNode extends EntityProps, SizeProps {
  type: 'icon';
  library?: Str;
  icon?: Str;
  weight?: Num;
  fill?: Fills;
  effect?: Effects;
}

export interface ScriptNode extends EntityProps, SizeProps {
  type: 'script';
  clip?: Bool;
  scriptUri?: string;
  inputs?: Record<string, string | number | boolean>;
}

export interface BrowserNode extends EntityProps, SizeProps, StrokeProps {
  type: 'browser';
  url?: string;
  deviceId?: string;
  zoom?: number;
  scrollX?: number;
  scrollY?: number;
  cornerRadius?: CornerRadius;
  effect?: Effects;
}

export interface RefNode extends EntityProps {
  type: 'ref';
  /** Id of the reusable node this instance copies. */
  ref: string;
  /** Keyed by descendant id path or unique name. With `type`: replacement subtree; without: property overrides. */
  descendants?: Record<string, Record<string, unknown>>;
  /** Overrides of the component root's properties. */
  [key: string]: unknown;
}

export type Node =
  | FrameNode | GroupNode | RectangleNode | EllipseNode | PolygonNode | PathNode | TextNode
  | NoteNode | ContextNode | PromptNode | IconNode | ScriptNode | BrowserNode | RefNode;

export type NodeType = Node['type'];

export type VariableType = 'boolean' | 'color' | 'number' | 'string';
export type VariableValue = boolean | number | string;
export interface ThemedValue { value: VariableValue; theme?: Theme }
export interface Variable { type: VariableType; value: VariableValue | ThemedValue[] }

export interface PenDocument {
  version: string;
  /** Axis name -> values; the first value is the default. */
  themes?: Record<string, string[]>;
  /** Alias -> relative path of an imported .pen file. */
  imports?: Record<string, string>;
  variables?: Record<string, Variable>;
  children: Node[];
  [key: string]: unknown;
}

export const CONTAINER_TYPES: ReadonlySet<NodeType> = new Set(['frame', 'group']);
