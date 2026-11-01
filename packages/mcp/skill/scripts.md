# Script nodes

A script node is a layer whose content a JavaScript file makes: `{type: "script", name: "Revenue", width: 360, height: 220, scriptUri: "scripts/bar-chart.js", inputs: {values: "4, 8, 15"}}`. nib runs the script and draws what it returns inside the node's box; the layers are not stored in the document, so changing an input or the file redraws them. Use one for content that follows data or rules: charts, patterns, grids, generative art.

## Getting a script file

`Script(name)` copies one of nib's scripts into the document's `scripts` folder and returns its url: `bar-chart` (bars from a list of values), `dot-pattern` (a grid of dots growing toward a corner), `confetti` (pieces scattered at random angles). `Script(name, source)` saves your own JavaScript as `scripts/<name>.js` after running it once (a script that throws or returns something that is not layers fails the call and says why).

## Writing one

```js
// A row of stars for a rating.
// @input rating 3.5 0..5 Rating
// @input color #FFB400 Stars
function render(input, size) {
  const d = size.height;
  return Array.from({ length: 5 }, (_, i) => ({
    type: "path", x: i * (d + 4), y: 0, width: d, height: d,
    geometry: "M12 2l3 7h7l-5.5 4.5 2 7.5-6.5-4.5-6.5 4.5 2-7.5L2 9h7z", viewBox: [0, 0, 24, 24],
    fill: i < Math.round(input.rating) ? input.color : "#E5E5EA",
  }));
}
```

- `render(input, size)` returns layers (or one layer) as you would pass them to `Insert`: rectangles, ellipses, paths, text, frames with children; positions are in the node's box (0, 0 at its top-left), `size` is its width and height. Instances (`ref`) are not drawn.
- `// @input name default [min..max] label` declares a control: a number (with a range it becomes a slider), a color (`#RRGGBB`), `true`/`false`, or text in double quotes. The node's `inputs` hold the values people set; the others take the default.
- Scripts run in their own sandbox: no files, network or nib API, at most 2 seconds and 1000 layers. `Math.random` is seeded from the node, so a script draws the same each time; another node with the same script draws differently.
- Problems (an error, a layer that is not valid) are listed in the reply after the snippet that inserts or changes the node.
- In the editor, "Convert to layers" replaces the node with a frame of what it drew, to edit by hand.
