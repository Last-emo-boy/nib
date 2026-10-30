# Designing with nib

nib edits `.pen` design files: JSON documents holding a canvas of nodes (frames, text, shapes, icons, component instances). You change a document by sending JavaScript snippets to the `execute` tool. Each snippet calls a small design API (`Insert`, `Update`, `Get`, ...) and runs as one transaction. nib saves the file after every snippet that changed it.

## Tools

| Tool | Use |
|---|---|
| `get_app_state` | Open documents, their top-level frames with sizes, components, variables. Pass `filePath` to open one. |
| `execute` | Run a snippet against a document (`filePath` + `input`). On failure, fix it with `editId` + `edits`. |
| `read_skill` | This guide. Pass `path` for the files below. |
| `get_style` | Style presets: palettes, type scales, spacing and component rules to design with. |

## Workflow

1. **Look first.** `get_app_state({filePath})`, then read what is there: list top-level frames, components and variables (`Get(n => ...)`, `GetVariables()`). Reuse the document's components and variables instead of inventing new ones.
2. **Set up tokens.** For new work, pick a style (`get_style()`), and turn its colors, radii and spacing into variables with `SetVariables`. Reference them as `"$name"`.
3. **Build in passes.** One snippet per section or component, roughly 20 to 80 lines. Create the screen frame first (placed with `FindEmptySpace`), keep its id in a global (`screen = Insert(...)`), then fill it in later calls.
4. **Check every pass.** End a snippet with `TakeScreenshot([id])` and look at the image. Read the reply's Issues section: collapsed sizes, `fill_container` without a layout, missing icons or fonts. Fix them before moving on.
5. **Finish.** Review the whole screen, fix spacing and alignment, then report what you made, with the frame ids.

## Rules that prevent most mistakes

- Pass ids (strings) to the API, never node objects: `Update(n.id, ...)`.
- Text needs a `fill`, or it is invisible. Text does not wrap unless it has `textGrowth: "fixed-width"` and a `width` (a number or `"fill_container"`).
- Frames lay out their children in a row by default (`layout: "horizontal"`) and size to fit them. Use `layout: "vertical"` for stacks, `layout: "none"` to place children by `x`/`y`.
- `width: "fill_container"` only works inside a frame with a horizontal or vertical layout. A top-level frame needs a fixed width (1440 for desktop, 390 for a phone).
- Use `gap` and `padding` for spacing. There is no margin.
- Don't put `const` results you need later in `const`: assign to a global (`card = Insert(...)`) so the next snippet can use it.
- Never write ids yourself. nib generates them; read them from the reply's "Created nodes" list or from return values.

## Files

| Path | Contents |
|---|---|
| `execute.md` | The snippet API: every function, its arguments, the reply format, error recovery, examples. Read before the first `execute`. |
| `schema.md` | Node types and their properties: fills, strokes, effects, text, icons. |
| `layout.md` | How frames size and place children: layouts, `fit_content`, `fill_container`, text sizing, absolute positioning. |
| `components.md` | Components, instances, overrides through `descendants`, instance paths, slots. |
| `variables.md` | Variables and themes (light/dark modes and other axes). |
| `guide/design.md` | Craft: hierarchy, spacing, type, color, and a review checklist. |
| `guide/web-app.md` | Desktop app screens: shells, sidebars, tables, forms. |
| `guide/landing-page.md` | Marketing pages: hero, sections, proof, calls to action. |
| `guide/mobile-app.md` | Phone screens: sizes, safe areas, navigation, touch targets. |
| `guide/dashboard.md` | Data screens: metrics, charts drawn from shapes, tables. |
| `guide/slides.md` | Presentation decks: 1920×1080 slides, type scale, layouts. |
| `guide/design-system.md` | Building a component library and documenting it on the canvas. |
