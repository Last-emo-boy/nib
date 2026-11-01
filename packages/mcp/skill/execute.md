# The execute API

`execute({filePath, input})` runs `input`, a JavaScript snippet, against the document at `filePath`.

## How a snippet runs

- The snippet is the body of a function in a sandbox (QuickJS, ES2023). There is no `await`, no network, no file access; every API function is synchronous. `return` ends the snippet early.
- **Globals carry over.** `const`, `let` and `function` declarations are local to one call. A plain assignment (`hero = Insert(...)`) creates a global that later calls can read. Globals live as long as the nib server process.
- **All or nothing.** If the snippet throws, every change it made is rolled back and the globals it assigned are discarded. The reply shows the error with its line and an `editId`.
- **Fix with edits.** Call `execute({filePath, editId, edits: [{find, replace}]})` instead of resending the whole snippet. Each `find` must occur exactly once in the snippet (set `all: true` to replace every occurrence). The patched snippet then runs from the start. If it fails again, keep patching under the same `editId`; your edits apply to the already patched text.
- A single API call that fails leaves nothing behind, even when your snippet catches its error and continues.
- Snippets stop after 30 seconds.

## Paths

Functions take a `path`: a node id like `"a1B2c"`, or `document` (a predefined constant) for the top level of the canvas.

Inside a component instance, address nodes with slash paths: `instanceId + "/" + childId`, any depth (`"card/header/title"`). Changing a node through a path writes an override into that instance only. Slashes never address ordinary children; for those, use the child's own id.

Always pass ids. When you hold a node from `Get`, pass `node.id`.

## Mutations

### `Insert(parent, node) → id`

Adds `node` as the last child of `parent` (a frame, a group, a frame inside an instance, or `document`). `node` may include `children`, so a whole subtree can go in one call. Returns the new node's id (a path when inserting inside an instance). Ids in `node` are ignored: nib assigns new ones.

```js
screen = Insert(document, {type: "frame", name: "Settings", width: 1440, height: 900, layout: "vertical", fill: "$bg", x: 0, y: 0})
const header = Insert(screen, {type: "frame", name: "Header", width: "fill_container", padding: [20, 32], alignItems: "center", justifyContent: "space_between"})
Insert(header, {type: "text", name: "Title", content: "Settings", fontSize: 24, fontWeight: "600", fill: "$text"})
```

To make an instance, insert `{type: "ref", ref: componentId, ...}` (see `components.md`), or use `Use`.

### `Use(parent, component, parts?, props?) → id`

Inserts an instance of `component` (an id, or `alias:id` for a library's component). `parts` overrides the texts and icons inside it, keyed as `get_app_state` lists them for each library component: a string sets a text's content or an icon's name, an object sets any properties. `props` goes on the instance itself (size, position, name).

```js
save = Use(footer, "shadcn:button", {"button-label": "Save"})
Use(form, "shadcn:field", {"field-label/label-text": "Email", "field-input/input-text": "you@example.com"}, {width: "fill_container"})
```

A key that does not exist fails with the component's list of texts and icons.

### `Copy(path, parent, changes?) → id`

Copies the node at `path` into `parent` and returns the copy's id. Copying a component (`reusable: true`) creates an instance of it. Other nodes are deep-copied with new ids for every descendant; read them with `Get(copyId)`.

`changes` sets properties on the copy, e.g. `{x: 1600, name: "Settings v2"}`. Its `descendants` object changes nodes inside the copy, keyed by the source node's child ids or unique names:

```js
v2 = Copy(screen, document, {x: 1600, name: "Settings v2", descendants: {Title: {content: "Preferences"}}})
```

Copies keep the source's `x`/`y` unless `changes` gives new ones.

### `Update(path, props)`

Merges `props` into the node. `id`, `type` and `children` cannot be changed (use `Replace`, `Insert`, `Move`, `Delete`). Through an instance path it writes an override for that instance. On an instance itself, `descendants` entries merge with existing ones.

```js
Update(titleId, {content: "Account", fontSize: 28})
Update(cardId + "/" + labelId, {content: "Revenue"})
```

### `Replace(path, node) → id`

Puts a new node in the place of the one at `path` and returns its id. Inside an instance this swaps that part of the instance only (the component is unchanged), and the returned path addresses the new node.

### `Move(path, parent?, index?)`

Moves a node to `parent` (an id or `document`) at `index` (default: the end). Without `parent` it stays in its parent and moves to `index`. Nodes inside instances cannot be moved.

### `Delete(path)`

Removes a node and its subtree. To hide part of an instance, use `Update(path, {enabled: false})` instead.

### `SetVariables(variables, replace?)`

Adds or changes variables (`replace: true` replaces them all). See `variables.md`.

```js
SetVariables({bg: {type: "color", value: "#ffffff"}, "radius-card": {type: "number", value: 12}})
```

### `Generate(path, kind, prompt, options?) → url`

Fills a frame, rectangle or ellipse with a picture of what `prompt` describes, cropped to cover it, and returns the picture's path:

- `"stock"`: a photo, openly licensed, from Openverse or Wikimedia Commons (no key needed). Its credit (title, author, license, source) is printed in the reply and kept in `images/CREDITS.md`. `options.index` (0–9) takes the next best matches when the first does not fit. Describe what is in the photo in plain words: `"woman reading by a window"`, not adjectives about mood.
- `"image"`: a picture an image model makes from the prompt (needs the person's OpenAI key; without one the call fails and says so, so use `"stock"`).

Pictures are saved in an `images` folder next to the .pen file. Size the layer first: the picture is chosen and made for its shape.

```js
hero = Insert(page, {type: "frame", name: "Hero photo", width: "fill_container", height: 320, cornerRadius: 16})
Generate(hero, "stock", "mountain lake at sunrise")
```

### `Vectorize(path, options?) → id`

Turns the picture a layer shows (its image fill, as cropped) into flat-colored shapes: a frame of paths, one per color, stacked from the color covering most of the picture up. A top-level picture gets the frame beside it; one inside a frame is replaced in place (the picture is hidden, `enabled: false`, so it can come back). Options: `colors` (2–24, default 8), `detail` (`"low"`, `"medium"` default, `"high"`). Logos, icons and flat illustrations come out clean with few colors; photos come out posterized.

### `RemoveBackground(path, options?) → url`

Takes the background away from the picture a layer shows and fills the layer with the result (a PNG with transparency in the `images` folder). `method: "color"` (default) removes a plain background (a product shot, a portrait against a wall), from the edges inwards; `tolerance` (default 0.12) says how far from the background's color still counts as background. `method: "model"` asks an image model to cut out the subject from any background (needs the person's OpenAI key).

### `Repeat(template, rows, options?) → ids`

Fills a list from data: one copy of `template` per row, after it in its parent, with every `{{field}}` in its strings (text, names, image urls, colors) replaced by the row's value (`{{address.city}}` reads nested values). The template stays, hidden, with its placeholders; repeating it again replaces the copies made before, so the same call refreshes the list. Put the template in a frame with a vertical or horizontal layout so the rows stack; in a frame without a layout they go down from the template, `options.gap` (default 12) apart. Placeholders go in strings that take any text; for colors and numbers use `options.bind`, which sets properties of the template's layers by name from row fields: `{bind: {"Avatar": {fill: "color"}, "Bar": {width: "share"}}}`.

### `ReadData(path) → rows`

Rows from a `.csv` (header line first) or `.json` file (a list of objects, or an object holding one) next to the .pen file.

### `FakeData(fields, count, options?) → rows`

`count` rows (up to 500) of believable made-up values, each field chosen by its name: name, firstName, email, phone, company, job/title/role, city, country, address, status, product, tag, price/amount, percent/change, rating, date, time, color, number/count, headline, description/bio/text, id/code; anything else gets a word. `options.locale`: `"en"` (default) or `"zh"` for Chinese names, cities and dates; `options.seed` for another set (the same seed gives the same rows).

```js
row = Insert(list, {type: "frame", name: "Person", width: "fill_container", layout: "horizontal", gap: 12, padding: 12})
Insert(row, {type: "text", content: "{{name}}", fontWeight: "600"})
Insert(row, {type: "text", content: "{{email}}", fill: "#6B6F7A"})
Repeat(row, FakeData(["name", "email"], 8))
```

### `ExtractStrings(path, options?) → keys`

Makes the texts under `path` (a layer or a list of them) translatable: each distinct literal text becomes a string variable `str.<frame>.<text>` with its words as the value for `options.language` (default: the first value of the Language axis, else `"en"`), and the text layers show the variable. See "Text in several languages" in `variables.md`.

### `Shader(name, source?) → url`

A shader file for shader fills and effects (see `shaders.md`): nib's own `name` copied into the document's `shaders` folder, or your GLSL `source` saved as `shaders/<name>.frag` once it compiles.

### `Script(name, source?) → url`

A script file for script nodes (see `scripts.md`): nib's own `name` copied into the document's `scripts` folder, or your JavaScript `source` saved as `scripts/<name>.js` once it runs.

### `InsertSvg(parent, svg, props?) → id`

SVG markup as editable layers: a frame the size of the drawing holding its shapes as paths, inserted like `Insert` (`props` sets the frame's name, position and size). Use it to draw illustrations, logos and icons nib's icon sets do not have: write the SVG yourself, keeping it to shapes and paths (text and embedded images are left out).

```js
logo = InsertSvg(header, '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="20" fill="#2F6FEB"/><path d="M14 26l7 7 13-15" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round"/></svg>', {name: "Logo", width: 32, height: 32})
```

## Reading

### `Get(path, options?) → node`

The node as stored, with its children. Options:

| Option | Default | Effect |
|---|---|---|
| `depth` | all levels | Levels of children to include; deeper children read `"..."`. `depth: 0` is the node alone. |
| `resolveVariables` | false | Show computed values instead of `"$name"` references. |
| `resolveInstances` | false | Show instances as the full subtree they display, with ids as paths. |
| `includePathGeometry` | false | Include path `geometry` strings (otherwise `"..."`). |

`Get(document)` returns `{children: [...]}`: the top-level nodes without their children (use `depth` for more).

### `Get(path, visit, options?) → array` and `Get(visit, options?) → array`

Walks the subtree at `path` (or every top-level node) and calls `visit(node, ctx)` on each node, parents before children. Whatever `visit` returns, except `undefined`, is collected into the result. Instances are walked into: their children appear with path ids, so `Update(n.id, ...)` on them writes overrides.

`ctx` holds:

| Field | Meaning |
|---|---|
| `node` | The node (same as the first argument). |
| `parentCtx` | The parent's `ctx`; `undefined` at the start. |
| `depth` | 0 for the starting nodes. |
| `index` | Position among its siblings. |
| `bounds` | `{x, y, width, height}` after layout, relative to the parent (the space of `x`/`y`). |
| `problems` | `"partially clipped"` or `"fully clipped"` when the node sticks out of its parent. |
| `skipChildren()` | Don't descend into this node. |

```js
// All text below 12px, made legible
Get(screen, n => n.type === "text" && n.fontSize < 12 && Update(n.id, {fontSize: 12}))

// Find a node by name
const save = Get(screen, n => n.name === "Save button" ? n.id : undefined)[0]

// Outline of a screen, two levels deep
Get(screen, (n, c) => { Print("  ".repeat(c.depth) + n.id, n.type, n.name ?? "", c.bounds.width + "x" + c.bounds.height); if (c.depth === 2) c.skipChildren() })

// Layout problems
Get(screen, (n, c) => c.problems && Print(n.name, c.problems, "in", c.parentCtx?.node.name))
```

### `GetVariables() → {variables, themes?}`

### `FindEmptySpace({width, height, direction?, padding?, nodeId?}) → {x, y, parentId?}`

A free spot for a new node of that size. Without `nodeId` it is beside everything on the canvas; with `nodeId` it is beside that node, among its siblings (`parentId` names their parent). `direction` is `"right"` (default), `"bottom"`, `"left"` or `"top"`; `padding` is the distance kept from other nodes.

```js
const at = FindEmptySpace({width: 1440, height: 900, padding: 120})
screen = Insert(document, {type: "frame", name: "Checkout", x: at.x, y: at.y, width: 1440, height: 900, layout: "vertical"})
```

### `Print(...values)`

Adds a line to the reply: strings as they are, other values as JSON, separated by spaces. `console.log` does the same.

### `TakeScreenshot(ids)`

Renders the nodes as they are at this point of the snippet; the images are attached to the reply. `"document"` renders the whole canvas. Look at every screenshot you take.

### `Compare(id, reference)`

Compares how node `id` looks with a picture: `reference` is a node on the canvas (often a placed screenshot, or another design) or the path of an image file (relative paths start at the .pen file's folder; files people attach in nib's chat are named in their message). Both are drawn at the reference's size, and the reply's **Comparisons** section says how similar they are, what share of pixels differ, and in which ninths of the picture most of the difference is (top-left … bottom-right); an image of the difference is attached (the design in gray, what differs in red). Use it to recreate a screenshot or page: build, compare, fix the regions it names, and compare again until it is at least 95% similar. It tells you when the proportions differ: make the frame the reference's shape first.

### `Review(id)`

Reviews the top-level frame that holds `id` once the snippet's changes are laid out, the way a careful designer would, and lists what it finds in the reply's **Review** section with the layer ids: text hard to read against its background (WCAG contrast), text under 11px, things to tap smaller than 44×44 on a phone (24×24 elsewhere), text cut off by a frame that clips it, layers that run out of their container, edges a few pixels off and gaps a few pixels unequal. Run it after building or changing a screen, and fix what it lists.

### `Export(ids, format, outputPath, options?)`

Writes files after the snippet succeeds. Formats: `"png"`, `"jpeg"`, `"webp"` (one file per node, named `<id>.<ext>`, into the folder `outputPath`), `"pdf"` (one page per node, into the file `outputPath`), `"html-css"` and `"html-tailwind"` (one file), `"react-tailwind"` (one `.tsx` file: a React component per node, instances of shadcn/ui or HeroUI components written as those components). Relative paths start at the .pen file's folder. Options: `scale` (images and pdf, default 2), `quality` (jpeg/webp, 1 to 100), `includeHtmlScaffold` (default true), `includeLayerNames` (data attributes, default true), `includeLayerIds` (default false).

## The reply

- `OK`, then sections when they apply:
- **Created nodes**: name and id of each node the snippet created, marked `(= varName)` when a global holds that id.
- **Print output**.
- **Issues**: problems in the nodes you changed. Fix them in your next call.
- **Comparisons**: one line per `Compare`.
- **Review**: what each `Review` found.
- **Screenshots**: what each attached image is, in order (screenshots and differences from `Compare`).
- **Exported**: files written.

On failure: the error, the line it came from, `Print` output produced before it, and the `editId`.

## Example: a component and a row of instances

```js
metric = Insert(document, {type: "frame", name: "Metric", reusable: true, layout: "vertical", gap: 4, padding: 16, width: 220, fill: "$surface", cornerRadius: 12, x: 0, y: 1000})
metricLabel = Insert(metric, {type: "text", name: "Label", content: "Label", fontSize: 13, fill: "$text-muted"})
metricValue = Insert(metric, {type: "text", name: "Value", content: "0", fontSize: 28, fontWeight: "600", fill: "$text"})
```

```js
const row = Insert(screen, {type: "frame", name: "Metrics", width: "fill_container", gap: 16})
for (const [label, value] of [["Revenue", "$48.2K"], ["Users", "1,204"], ["Churn", "2.1%"]]) {
  Insert(row, {type: "ref", ref: metric, width: "fill_container", descendants: {[metricLabel]: {content: label}, [metricValue]: {content: value}}})
}
TakeScreenshot([screen])
```

## Plugins

A snippet the person can run again from the command palette (or `nib plugin <file> <id>`) is a plugin: a `.js` file in `~/.nib/plugins/`, or in a `plugins/` folder beside the design. It starts with comments naming it and its inputs, and reads `selection` (the ids selected when it runs) and `input` (its inputs' values). It runs like any snippet, as one undo step named after it; what it prints is shown to the person.

```js
// @name Snap to grid
// @description Round positions and sizes to a step.
// @input step 8 1..64 Grid step (px)
for (const id of selection) Get(id, (n) => { if (typeof n.x === "number") Update(n.id, {x: Math.round(n.x / input.step) * input.step}) })
Print("Snapped")
```

`@input name default label`: a number (with an optional `min..max`), a color (`#RRGGBB`), `true`/`false`, or text in quotes.
