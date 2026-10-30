# Web app screens

## Canvas

- Desktop screens: 1440 wide, 900 to 1024 tall for a viewport; let long pages grow (`height: "fit_content"` on the screen frame, or a large fixed height). 1280 for compact layouts.
- Place each screen with `FindEmptySpace({width, height, padding: 120})` and name it after the page: `"Settings · Billing"`. Variants go to the right of the original.

## Shell

Most app screens share a shell; build it once as components or copy the first screen.

```js
screen = Insert(document, {type: "frame", name: "Projects", x: at.x, y: at.y, width: 1440, height: 900, fill: "$bg", clip: true})
sidebar = Insert(screen, {type: "frame", name: "Sidebar", width: 248, height: "fill_container", layout: "vertical", padding: [16, 12], gap: 2, fill: "$surface", stroke: "$border", strokeWidth: {right: 1}})
main = Insert(screen, {type: "frame", name: "Main", width: "fill_container", height: "fill_container", layout: "vertical"})
topbar = Insert(main, {type: "frame", name: "Top bar", width: "fill_container", height: 56, padding: [0, 24], alignItems: "center", gap: 12, stroke: "$border", strokeWidth: {bottom: 1}})
content = Insert(main, {type: "frame", name: "Content", width: "fill_container", height: "fill_container", layout: "vertical", padding: 32, gap: 24})
```

- Sidebar: 220 to 280 wide, nav items 32 to 36 tall with a 16 to 20px icon, label 14px, the active item marked by a tinted background and stronger text.
- Top bar: 48 to 64 tall; page title or breadcrumbs left, search and actions right.
- Content: a page header (title 24 to 28px, description, primary action on the right), then sections.

## Tables

- Header row 36 to 40 tall, muted 12 to 13px labels; body rows 44 to 56 tall; dividers 1px `$border` at the bottom of rows.
- Columns: a frame per row with fixed-width cells (`width: 160`) and one flexible cell (`width: "fill_container"`) so the row fills the table. Right-align numbers.
- Build the row as a component, then insert instances with `descendants` overrides for each record.

## Forms

- Labels above fields (13 to 14px, weight 500), 6 to 8px gap to the field. Fields 36 to 40 tall, 1px border, radius 6 to 8, padding `[0, 12]`.
- Group fields into sections with a heading and short description; 24 to 32px between sections.
- One primary button per form, at the end; secondary actions as outlined or text buttons.

## States

Design the states the user will meet: empty (an icon, one sentence, an action), loading (skeleton bars in `$surface`), error (inline message near the cause), selected and hover for interactive rows.
