// Render top-level frames of a .pen file to PNG: node scripts/render.ts <file.pen> <outDir> [name-filter]
import fs from 'node:fs';
import path from 'node:path';
import { buildScene, PenDoc } from '@nib/core';
import { parsePen } from '@nib/format';
import { createNodeRenderer, imagesFor } from '@nib/render/node';

const [file, outDir, filter] = process.argv.slice(2);
const doc = new PenDoc(parsePen(fs.readFileSync(file, 'utf8')));
const renderer = await createNodeRenderer();
const images = imagesFor(file);
fs.mkdirSync(outDir, { recursive: true });
for (const top of doc.data.children) {
  const name = top.name ?? top.id;
  if (filter && !name.includes(filter)) continue;
  const scene = buildScene(doc, top);
  if (!scene) continue;
  const t = performance.now();
  const png = await renderer.renderPNG(scene, images);
  const out = path.join(outDir, `${name.replace(/[^\p{L}\p{N}._-]+/gu, '_')}.png`);
  fs.writeFileSync(out, png);
  console.log(`${(performance.now() - t).toFixed(0)}ms ${out}`);
}
console.log(JSON.stringify(renderer.report(images)));
