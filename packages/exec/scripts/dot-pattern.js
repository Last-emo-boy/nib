// A field of dots that grow toward one corner, each a little off the grid.
// @input spacing 18 6..80 Spacing
// @input color #1C1C28 Dots
// @input randomness 0.3 0..1 Randomness
function render(input, size) {
  const s = Math.max(6, input.spacing);
  const cols = Math.floor(size.width / s), rows = Math.floor(size.height / s);
  const out = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const grow = (x / Math.max(1, cols - 1) + y / Math.max(1, rows - 1)) / 2;
      const d = s * (0.15 + 0.55 * grow) * (1 - input.randomness * 0.5 + Math.random() * input.randomness);
      const jx = (Math.random() - 0.5) * s * input.randomness * 0.5, jy = (Math.random() - 0.5) * s * input.randomness * 0.5;
      out.push({ type: 'ellipse', x: x * s + (s - d) / 2 + jx, y: y * s + (s - d) / 2 + jy, width: d, height: d, fill: input.color });
    }
  }
  return out.slice(0, 1000);
}
