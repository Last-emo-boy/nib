# Dashboards

## Layout

- 1440 × 900 or taller, with the web-app shell (sidebar, top bar). Content in a vertical stack: page header with a date range and filters, a metric row, then charts and tables in a grid.
- Grid: rows of cards with `gap: 16` to `24`; cards `width: "fill_container"` so they share the row, or fixed fractions for a 2:1 split (`width: "fill_container"` on the wide card and a fixed `width: 400` on the narrow one).
- Cards: `$surface` fill or a 1px border, radius 12, padding 20 to 24, a title row (14 to 16px, weight 600, plus an action or menu icon on the right), then the content.

## Metrics

- Label (13px, muted), value (24 to 32px, weight 600, tabular figures read best in fonts like Inter), change (12 to 13px, green or red with an up or down arrow icon), and optionally a sparkline.
- Make the metric card a component and fill a row with instances.

## Charts from shapes

Charts are frames with `layout: "none"` holding shapes at computed positions. Compute coordinates in the snippet:

```js
const data = [12, 18, 15, 24, 30, 27, 36], w = 560, h = 200, barW = 48
chart = Insert(card, {type: "frame", name: "Chart", width: w, height: h, layout: "none"})
const max = Math.max(...data), step = w / data.length
data.forEach((v, i) => {
  const bh = (v / max) * (h - 20)
  Insert(chart, {type: "rectangle", name: "Bar " + i, x: i * step + (step - barW) / 2, y: h - bh, width: barW, height: bh, cornerRadius: [4, 4, 0, 0], fill: "$accent"})
})
```

- Line charts: a `path` with `geometry` built from the points (`"M x0 y0 L x1 y1 ..."`), `viewBox: [0, 0, w, h]`, a stroke and no fill; add an area below with a gradient fill fading to transparent.
- Donuts: `ellipse` slices with `innerRadius: 0.6`, `startAngle` and `sweepAngle` from the data.
- Gridlines: 1px rectangles in `$border`; axis labels 11 to 12px muted text, absolutely placed.
- Use one hue in several shades for one series, distinct hues for different series, and a legend when there is more than one.

## Tables

Follow `web-app.md`. Add status badges (pill frames with a tinted fill and matching text) and right-aligned numbers.
