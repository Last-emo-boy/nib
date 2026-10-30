# Layout

Frames lay out their children like a single-line flexbox without wrapping.

## Direction

- `layout: "horizontal"` (the default): children in a row.
- `layout: "vertical"`: children in a column.
- `layout: "none"`: children sit at their `x`/`y`, like on the canvas. Use it for free compositions: illustrations, overlapping art, charts.

`gap` separates children; `padding` insets them from the frame's edges. `justifyContent` places children along the main axis (`start`, `center`, `end`, `space_between`, `space_around`), `alignItems` across it (`start`, `center`, `end`).

## Sizing

Each axis of a node is sized in one of three ways.

| Value | Meaning |
|---|---|
| A number | Fixed size in px. |
| `"fit_content"` | As big as its content: children plus gaps plus padding (for text: the text). **The default for frames.** |
| `"fill_container"` | Takes the parent's room. On the parent's main axis, filling children share the free space equally; across it, they stretch to the parent's inner size. |

Consequences:

- `fill_container` needs a parent that lays it out (horizontal or vertical). On the canvas, in a `layout: "none"` frame, in a group, or with `layoutPosition: "absolute"` it falls back to 0 (or to the fallback in `"fill_container(240)"`).
- A frame with no children and no fixed size collapses to 0 by 0 and is invisible. Give empty boxes (image placeholders, dividers, bars) a size.
- A `fit_content` parent counts a filling child at its fallback size. If a parent fits its content and its only child fills the parent on the same axis, both collapse to 0. Fix one of them: give the parent a size, or the child a size.
- Top-level frames (screens, slides, artboards) should get a fixed width, and usually a fixed height.

Typical patterns:

```js
// A full-width row whose middle part stretches
const bar = Insert(screen, {type: "frame", width: "fill_container", alignItems: "center", gap: 12, padding: [12, 24]})
Insert(bar, {type: "text", content: "Inbox", fill: "$text", fontSize: 16, fontWeight: "600"})
Insert(bar, {type: "frame", width: "fill_container", height: 1})          // spacer
Insert(bar, {type: "icon", icon: "search", width: 20, height: 20, fill: "$text-muted"})

// Two columns: fixed sidebar, flexible content
const body = Insert(screen, {type: "frame", width: "fill_container", height: "fill_container"})
Insert(body, {type: "frame", name: "Sidebar", width: 260, height: "fill_container", layout: "vertical", padding: 16, gap: 4, fill: "$surface"})
Insert(body, {type: "frame", name: "Main", width: "fill_container", height: "fill_container", layout: "vertical", padding: 32, gap: 24})

// Equal cards in a row
for (const t of ["Plan", "Build", "Ship"]) Insert(row, {type: "frame", width: "fill_container", layout: "vertical", padding: 20, gap: 8, fill: "$surface", cornerRadius: 12, children: [{type: "text", content: t, fill: "$text", fontSize: 18}]})
```

## Text sizing

- `textGrowth: "auto"` (default): the box is the text's size; lines break only at `\n`. A `width` is ignored.
- `textGrowth: "fixed-width"` with `width`: wraps at that width; the height follows the lines. With `width: "fill_container"` it wraps at whatever width the parent gives it: the usual choice for paragraphs.
- `textGrowth: "fixed-width-height"`: both fixed; `textAlignVertical` places the text inside.

Long text in a row overflows instead of wrapping unless you make it `fixed-width` with `fill_container` width.

## Absolute positioning

A child with `layoutPosition: "absolute"` keeps its `x`/`y` inside its laid-out parent and takes no space in the flow: badges on avatars, floating buttons, decorations. Its `x`/`y` are relative to the parent's top-left corner.

## Clipping

Children may extend past their parent; they are still drawn unless the parent has `clip: true`. Visitors report `ctx.problems` ("partially clipped", "fully clipped") for children outside their parent's box, which usually means a size or padding mistake.

## Strokes and size

Strokes do not change layout. `inner` strokes (the default) are drawn inside the box, so a 1px border does not shift the content.
