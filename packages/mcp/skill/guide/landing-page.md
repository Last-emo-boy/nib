# Landing pages

## Canvas

One frame 1440 wide, `layout: "vertical"`, height `"fit_content"` so the page grows with its sections. Each section is a full-width frame (`width: "fill_container"`) with large vertical padding (80 to 128) and a centered inner frame 1120 to 1200 wide for the content.

```js
page = Insert(document, {type: "frame", name: "Landing", x: at.x, y: at.y, width: 1440, layout: "vertical", fill: "$bg"})
section = (name, fill) => {
  const s = Insert(page, {type: "frame", name, width: "fill_container", padding: [96, 0], justifyContent: "center", ...(fill ? {fill} : {})})
  return Insert(s, {type: "frame", name: name + " content", width: 1160, layout: "vertical", gap: 32})
}
```

(Assign helpers to globals, as above, to reuse them in later calls.)

## Sections, in a usual order

1. **Navigation**: 64 to 80 tall; logo left, 3 to 5 links, one call to action right.
2. **Hero**: the promise in 6 to 10 words (48 to 72px, tight line height), one or two sentences of support (18 to 20px, muted), the primary action plus an optional secondary one, and a product visual. Two layouts work: centered text over a wide visual, or text left and visual right.
3. **Proof**: customer logos or one strong metric, close under the hero.
4. **Features**: three to six benefits, each with an icon, a short title and one or two lines; or alternating text and screenshot rows for the main two or three features.
5. **Detail**: how it works in steps, an integration grid, or a product deep dive.
6. **Social proof**: testimonials with a name, role, and photo or initials.
7. **Pricing** (if any): two to four plan cards, the recommended one highlighted.
8. **Final call to action**: a contrasting band repeating the main action.
9. **Footer**: link columns, small print.

## Craft

- Alternate section backgrounds (`$bg`, `$surface`) or separate with generous space; don't box every section.
- Keep one accent color for actions. Headings in the primary text color, not the accent.
- Product visuals: build a simplified screen with frames and text (it scales and stays editable), or an image fill.
- Check the page at full size with `TakeScreenshot([page])`, then zoom into each section with screenshots of the section frames.
