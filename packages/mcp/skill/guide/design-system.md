# Design systems

A design system in a .pen file is three things: variables (tokens), components, and documentation frames that show them.

## 1. Tokens

Create variables first (`variables.md`), grouped by prefix:

- Color: `bg`, `surface`, `surface-raised`, `border`, `text`, `text-secondary`, `text-muted`, `accent`, `accent-hover`, `on-accent`, `success`, `warning`, `danger`. Theme them for light and dark from the start if both are needed.
- Spacing: `space-1` 4, `space-2` 8, `space-3` 12, `space-4` 16, `space-6` 24, `space-8` 32, `space-12` 48.
- Radius: `radius-sm` 6, `radius-md` 8, `radius-lg` 12, `radius-full` 999.
- Type sizes as numbers if the system names them: `text-sm` 13, `text-base` 15, `text-lg` 18.

## 2. Components

Build each component as a frame with `reusable: true`, bound to tokens, with named parts. Start with the primitives and compose upward:

1. Button (primary, secondary, ghost, danger; small and medium): make one base component and the variants as reusable instances of it with overrides (`{type: "ref", ref: base, reusable: true, fill: "$surface", descendants: {Label: {fill: "$text"}}}`).
2. Input, select, checkbox, radio, switch, with label and help text.
3. Badge, avatar, tag, tooltip.
4. Card, list row, table row, nav item, tabs, modal, toast.

Keep component names consistent (`"Button / Primary"`, `"Button / Secondary"`) and give every part a name instances can override (`Label`, `Icon`, `Value`).

## 3. Documentation on the canvas

- A frame per area ("Colors", "Typography", "Buttons", ...), `layout: "vertical"`, padding 48, with a title, a one-line description, and the examples.
- Colors: swatches (a 120 × 80 rectangle with the variable as fill, its name and value as text below).
- Type: each style rendered with its name, size and weight.
- Components: instances in every variant and state, in a row or grid, each labeled.

## Using it

Screens should use instances and tokens, not detached copies with literal colors. Check with a visitor:

```js
Get(screen, n => (typeof n.fill === "string" && n.fill.startsWith("#")) ? Print(n.id, n.name, n.fill) : undefined)
```
