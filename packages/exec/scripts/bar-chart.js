// A bar chart from a list of values.
// @input values "12, 19, 7, 24, 15, 30" Values
// @input color #2F6FEB Bars
// @input gap 12 0..60 Gap
// @input radius 6 0..30 Corner radius
// @input labels true Show the values
function render(input, size) {
  const values = String(input.values).split(/[,\s]+/).map(Number).filter((v) => Number.isFinite(v));
  if (!values.length) return [];
  const max = Math.max(...values, 1);
  const top = input.labels ? 22 : 0;
  const width = Math.max(1, (size.width - input.gap * (values.length - 1)) / values.length);
  return values.flatMap((v, i) => {
    const h = Math.max(0, (size.height - top) * (v / max));
    const x = i * (width + input.gap);
    const r = Math.min(input.radius, width / 2, h);
    const bar = { type: 'rectangle', name: `Bar ${i + 1}`, x, y: size.height - h, width, height: h, cornerRadius: [r, r, 0, 0], fill: input.color };
    if (!input.labels) return [bar];
    return [bar, { type: 'text', name: `Value ${i + 1}`, x, y: size.height - h - 18, width, textGrowth: 'fixed-width', textAlign: 'center', content: String(v), fontSize: 12, fill: '#5A5A66' }];
  });
}
