# Variables and themes

Variables are named values stored in the document: colors, numbers, strings, booleans. Properties reference them as `"$name"`. Changing a variable updates every node that uses it, so a document built on variables can be restyled in one call.

```js
SetVariables({
  bg: {type: "color", value: "#ffffff"},
  surface: {type: "color", value: "#f6f7f9"},
  text: {type: "color", value: "#111827"},
  "text-muted": {type: "color", value: "#6b7280"},
  accent: {type: "color", value: "#4f46e5"},
  "radius-card": {type: "number", value: 12},
  "space-section": {type: "number", value: 64},
})
Insert(screen, {type: "frame", fill: "$surface", cornerRadius: "$radius-card", padding: 24})
```

- Names are written without `$` in `SetVariables`, with `$` in properties. Kebab-case names read well: `text-muted`, `radius-card`.
- Types: `"color"` (hex), `"number"`, `"string"`, `"boolean"`.
- A value can be another variable: `{type: "color", value: "$accent"}`.
- `SetVariables(vars)` adds or replaces the named variables and keeps the rest; `SetVariables(vars, true)` replaces the whole set.
- `GetVariables()` returns `{variables, themes}`.
- A string starting with `$` that names no variable stays plain text, so `content: "$48.2K"` is safe.

## Themes

A themed variable has a list of values, each for a theme:

```js
SetVariables({
  bg: {type: "color", value: [{value: "#ffffff", theme: {mode: "light"}}, {value: "#0b0d12", theme: {mode: "dark"}}]},
  text: {type: "color", value: [{value: "#111827", theme: {mode: "light"}}, {value: "#f3f4f6", theme: {mode: "dark"}}]},
})
```

- Each theme axis (`mode` here) has values (`light`, `dark`); nib records them in the document's `themes`, in the order they first appear. The first value of each axis is the default.
- Set `theme: {mode: "dark"}` on a frame to show it, and everything inside, in that theme. Put a light and a dark copy of a screen side by side to check both.
- Axes combine: `{mode: "dark", density: "compact"}`. When several entries match, the last matching one wins, so list general entries before specific ones.
- An entry without `theme` applies everywhere: use it first as the fallback.

## Text in several languages

Translations are string variables on a theme axis named `Language`, whose values are language codes (`en`, `zh`, `ja`, `pt-BR`…; the first is the source). A text layer whose content is `"$str.home.title"` shows that variable's value for the language in effect, so a frame's `theme: {Language: "zh"}` shows it in Chinese, and a copy of a screen per language needs no other change.

```js
SetVariables({
  "str.home.title": {type: "string", value: [{value: "Plan your week", theme: {Language: "en"}}, {value: "规划你的一周", theme: {Language: "zh"}}]},
})
Update(title, {content: "$str.home.title"})
```

`ExtractStrings(path, {language})` (see execute.md) turns a screen's literal texts into such variables in one go. When you add a language, give every `str.*` variable a value for it (SetVariables keeps the other values only if you pass them too, so read them first with GetVariables), then check each language for text that runs out: translations are often longer.
