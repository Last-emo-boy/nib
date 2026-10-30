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

### `Generate(...)`

Image generation is not available in nib yet. Use image fills with an image URL or a file path relative to the .pen file.

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

### `Export(ids, format, outputPath, options?)`

Writes files after the snippet succeeds. Formats: `"png"`, `"jpeg"`, `"webp"` (one file per node, named `<id>.<ext>`, into the folder `outputPath`), `"pdf"` (one page per node, into the file `outputPath`), `"html-css"` and `"html-tailwind"` (one file), `"react-tailwind"` (one `.tsx` file: a React component per node, instances of shadcn/ui or HeroUI components written as those components). Relative paths start at the .pen file's folder. Options: `scale` (images and pdf, default 2), `quality` (jpeg/webp, 1 to 100), `includeHtmlScaffold` (default true), `includeLayerNames` (data attributes, default true), `includeLayerIds` (default false).

## The reply

- `OK`, then sections when they apply:
- **Created nodes**: name and id of each node the snippet created, marked `(= varName)` when a global holds that id.
- **Print output**.
- **Issues**: problems in the nodes you changed. Fix them in your next call.
- **Screenshots**: the ids, in the order the images are attached.
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
