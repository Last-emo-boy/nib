// Time scene building, layout and drawing per top-level node: node scripts/time-render.ts <file.pen>
import { readFileSync } from 'node:fs';
import { buildScene, PenDoc } from '@nib/core';
import { parsePen } from '@nib/format';
import { createNodeRenderer, imagesFor } from '@nib/render/node';

const file = process.argv[2];
const doc = new PenDoc(parsePen(readFileSync(file, 'utf8')));
const renderer = await createNodeRenderer();
const images = imagesFor(file);
const { ck } = renderer;
let total = 0;
for (const pass of ['cold', 'warm']) {
  total = 0;
  for (const n of doc.data.children) {
    const t0 = performance.now();
    const scene = buildScene(doc, n);
    if (!scene) continue;
    const t1 = performance.now();
    const prepared = await renderer.prepare(scene, images);
    const t2 = performance.now();
    const rec = new ck.PictureRecorder();
    renderer.draw(rec.beginRecording(ck.LTRBRect(-1e6, -1e6, 1e6, 1e6)), prepared, images);
    rec.finishRecordingAsPicture().delete();
    rec.delete();
    prepared.dispose();
    const t3 = performance.now();
    total += t3 - t0;
    if (pass === 'warm') console.log(`${(n.name ?? n.id).slice(0, 28).padEnd(28)} scene ${(t1 - t0).toFixed(0).padStart(5)} prepare ${(t2 - t1).toFixed(0).padStart(6)} draw ${(t3 - t2).toFixed(0).padStart(5)} ms`);
  }
  console.log(`${pass}: ${total.toFixed(0)} ms`);
}
