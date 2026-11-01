// @name Snap to grid
// @description Round the position and size of the selected layers, and of the layers in them, to a grid step.
// @input step 8 1..64 Grid step (px)
// @input inside true Also the layers inside them

if (!selection.length) { Print('Select the layers to snap first.'); return }
const snap = (v) => Math.round(v / input.step) * input.step
let count = 0
for (const id of selection) {
  Get(id, (node, ctx) => {
    // An instance's insides belong to its component.
    if (node.type === 'ref' || (!input.inside && ctx.depth === 0)) ctx.skipChildren()
    const props = {}
    for (const key of ['x', 'y', 'width', 'height']) {
      if (typeof node[key] === 'number' && snap(node[key]) !== node[key]) props[key] = snap(node[key])
    }
    if (Object.keys(props).length) { Update(node.id, props); count++ }
  })
}
Print(`Snapped ${count} layer${count === 1 ? '' : 's'} to ${input.step} px.`)
