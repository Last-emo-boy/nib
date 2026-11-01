// @name Number layers
// @description Name the selected layers in reading order, top to bottom and left to right: a name and a number (Card 1, Card 2…).
// @input name "Item" Name
// @input start 1 0..9999 First number

if (!selection.length) { Print('Select the layers to name first.'); return }
// Where each one is, relative to its parent: rows first (8 px apart counts as one row), then left to right.
const placed = selection.map((id) => ({ id, box: Get(id, (n, ctx) => { ctx.skipChildren(); return ctx.bounds })[0] }))
placed.sort((a, b) => (Math.abs(a.box.y - b.box.y) > 8 ? a.box.y - b.box.y : a.box.x - b.box.x))
placed.forEach((p, i) => Update(p.id, { name: `${input.name} ${input.start + i}` }))
Print(`Named ${placed.length} layer${placed.length === 1 ? '' : 's'} ${input.name} ${input.start}–${input.start + placed.length - 1}.`)
