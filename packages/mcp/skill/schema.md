# Nodes and properties

Every node has a `type` and an `id` (nib assigns ids). Unknown properties are rejected, with a message naming the property.

Values marked *var* may also be a `"$name"` variable reference.

## Common properties (all types)

| Property | Value |
|---|---|
| `name` | Layer name. Name everything you may look up later: `"Primary button"`, `"Price"`. |
| `x`, `y` | Position in the parent, in px. Used on the canvas (top level), in `layout: "none"` frames, in groups, and for `layoutPosition: "absolute"`. Ignored for children of a laid-out frame. |
| `enabled` | *var* `false` hides the node (and removes it from layout). |
| `opacity` | *var* 0 to 1. |
| `rotation` | *var* Degrees, counter-clockwise, around the top-left corner. |
| `flipX`, `flipY` | *var* Mirror the node. |
| `layoutPosition` | `"absolute"`: placed at `x`/`y` inside a laid-out frame, outside the flow (badges, overlays). |
| `reusable` | `true` makes the node a component (see `components.md`). |
| `theme` | `{axis: value}`, e.g. `{mode: "dark"}`: variables in this subtree use that theme. |
| `context` | Notes for designers and agents about this node. Not drawn. |
| `metadata` | `{type: "...", ...}`: free data for tools. Not drawn. |

## Sizes

`width` and `height` take a number (px), *var*, `"fit_content"`, or `"fill_container"`. Both keywords accept a fallback used when there is nothing to fit or fill: `"fit_content(320)"`, `"fill_container(200)"`. See `layout.md`.

## frame

The building block: a box with fills, strokes, corner radius, and children laid out in a row, a column, or freely.

| Property | Value |
|---|---|
| `children` | Nodes. |
| `layout` | `"horizontal"` (default), `"vertical"`, `"none"`. |
| `gap` | *var* Space between children, px. |
| `padding` | *var* `16`, `[vertical, horizontal]`, or `[top, right, bottom, left]`. |
| `justifyContent` | Main axis: `"start"`, `"center"`, `"end"`, `"space_between"`, `"space_around"`. |
| `alignItems` | Cross axis: `"start"`, `"center"`, `"end"`. |
| `clip` | *var* Clip children to the frame's shape. |
| `cornerRadius` | *var* `8`, or `[topLeft, topRight, bottomRight, bottomLeft]`. |
| `fill`, `stroke`, `strokeWidth`, `effect` | See below. |
| `placeholder` | `true` marks a frame as work in progress for pen.dev's editor. Optional; set it back to `false` when done if you used it. |

## group

Children at their own `x`/`y`; the group's box is their bounding box. Has `effect` but no fill. Prefer frames with `layout: "none"`.

## rectangle, ellipse, polygon, path

Shapes with `width`, `height`, `fill`, `stroke`, `effect`.

- `rectangle`: `cornerRadius`.
- `ellipse`: `innerRadius` (0 to 1, a fraction of the radius: a ring), `startAngle` and `sweepAngle` (degrees counter-clockwise from 3 o'clock: arcs and pie slices).
- `polygon`: `polygonCount` (sides), `cornerRadius`.
- `path`: `geometry` (SVG path data), `viewBox: [x, y, w, h]` (the geometry is scaled from the viewBox to the node's size), `fillRule` (`"nonzero"`, `"evenodd"`).

## text

| Property | Value |
|---|---|
| `content` | *var* The text. `\n` breaks lines. |
| `fill` | *var* Text color. **Required** to be visible. |
| `fontFamily` | *var* Any Google Fonts family or installed font. Default `"Inter"`. |
| `fontSize` | *var* px. Default 14. |
| `fontWeight` | *var* `"400"`, `"600"`, or names like `"medium"`, `"bold"`. |
| `fontStyle` | `"italic"` or `"normal"`. |
| `lineHeight` | *var* Multiple of the font size, e.g. `1.5`. Default: the font's own line height. |
| `letterSpacing` | *var* px. |
| `textAlign` | `"left"`, `"center"`, `"right"`, `"justify"`. |
| `textAlignVertical` | `"top"`, `"middle"`, `"bottom"` (with a fixed height). |
| `textGrowth` | `"auto"` (default: one line per paragraph, sized to the text), `"fixed-width"` (wraps at `width`, height grows), `"fixed-width-height"` (both fixed). |
| `underline`, `strikethrough` | *var* |
| `href` | A link target, kept in exports. |

Wrapping text needs `textGrowth: "fixed-width"` and a `width`: a number, or `"fill_container"` inside a laid-out frame.

## icon

`{type: "icon", library: "lucide", icon: "settings", width: 20, height: 20, fill: "$text"}`

| Property | Value |
|---|---|
| `library` | `"lucide"` (default, also answers for `"feather"`), `"phosphor"`. |
| `icon` | The icon's name in that library, kebab-case: `"arrow-right"`, `"circle-check"`. |
| `weight` | phosphor only: 100 thin, 300 light, 400 regular (default), 700 bold. |
| `fill` | Icon color. |

An unknown name is reported in the reply's Issues.

## note, context, prompt

Sticky-note cards on the canvas for comments and instructions (`content`, text style properties). `prompt` also has `model`.

## ref

An instance of a component: `{type: "ref", ref: componentId, descendants: {...}}`, plus overrides of the component root's properties. See `components.md`.

## Fills

`fill` (and `stroke`) take one fill or an array, drawn first to last (the last is on top).

| Form | Example |
|---|---|
| Color | `"#1a1a1a"`, `"#1a1a1a80"` (with alpha), `"$accent"` |
| Color object | `{type: "color", color: "#1a1a1a", blendMode: "multiply"}` |
| Linear gradient | `{type: "gradient", gradientType: "linear", rotation: 90, colors: [{color: "#ff7a00", position: 0}, {color: "#ff0069", position: 1}]}` |
| Radial / angular | `gradientType: "radial"` or `"angular"`, with `center: {x: 0.5, y: 0.5}` and `size: {width: 1, height: 1}` relative to the box |
| Image | `{type: "image", url: "photos/team.jpg", mode: "cover"}`. `mode`: `"cover"`, `"contain"`, `"stretch"`. `url`: http(s), or a path relative to the .pen file. |

Gradient `rotation` is in degrees counter-clockwise; 0 runs bottom to top, 90 runs right to left, 180 top to bottom, 270 left to right. Every fill object takes `enabled` and `blendMode`; gradient and image fills take `opacity`.

## Strokes

| Property | Value |
|---|---|
| `stroke` | A fill, like `fill`. |
| `strokeWidth` | *var* `1`, or per side `{top: 0, right: 0, bottom: 1, left: 0}` (a divider line). |
| `strokeAlignment` | `"inner"` (default), `"center"`, `"outer"`. |
| `strokeLinecap`, `strokeLinejoin` | For paths: `"butt"`/`"round"`/`"square"`, `"miter"`/`"bevel"`/`"round"`. |

## Effects

`effect` takes one effect or an array.

| Effect | Example |
|---|---|
| Drop shadow | `{type: "shadow", offset: {x: 0, y: 4}, blur: 16, spread: 0, color: "#0000001f"}` |
| Inner shadow | `{type: "shadow", shadowType: "inner", offset: {x: 0, y: 1}, blur: 2, color: "#00000014"}` |
| Layer blur | `{type: "blur", radius: 8}` |
| Background blur | `{type: "background_blur", radius: 20}` (frosted glass; give the node a translucent fill) |

Stack two soft shadows for natural elevation: a tight one (`y: 1, blur: 2`) and a wide one (`y: 8, blur: 24`) at low alpha.
