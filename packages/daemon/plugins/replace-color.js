// @name Replace a color
// @description Change one color to another in fills, strokes, shadows and gradients of the selection, or of the whole design when nothing is selected. Variables are left as they are.
// @input from #000000 Color to replace
// @input to #FFFFFF New color

const from = input.from.slice(0, 7).toLowerCase()
const to = input.to.slice(0, 7)
// A color keeps its own transparency (the last two digits of #RRGGBBAA).
const swap = (v) => {
  if (typeof v === 'string') return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) && v.slice(0, 7).toLowerCase() === from ? to + v.slice(7) : v
  if (Array.isArray(v)) return v.map(swap)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)]))
  return v
}
const SKIP = new Set(['id', 'type', 'name', 'content', 'context', 'metadata', 'children', 'descendants'])
let count = 0
const visit = (node, ctx) => {
  if (node.type === 'ref') ctx.skipChildren()
  const props = {}
  for (const [key, value] of Object.entries(node)) {
    if (SKIP.has(key)) continue
    const next = swap(value)
    if (JSON.stringify(next) !== JSON.stringify(value)) props[key] = next
  }
  if (Object.keys(props).length) { Update(node.id, props); count++ }
}
if (selection.length) for (const id of selection) Get(id, visit)
else Get(visit)
Print(count ? `Changed ${input.from} to ${input.to} on ${count} layer${count === 1 ? '' : 's'}.` : `No layer uses ${input.from}.`)
