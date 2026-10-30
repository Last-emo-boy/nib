// Contact sheet: each converted template rendered by nib next to a reference preview image.
// node scripts/template-sheet.ts <templates dir> <previews dir> <out.png> [first] [count]
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { buildScene, PenDoc, type SceneNode } from '@nib/core';
import { parsePen } from '@nib/format';
import { createNodeRenderer } from '@nib/render/node';

const [dir, previews, out, first = '0', count = '16'] = process.argv.slice(2);
const renderer = await createNodeRenderer();
const { ck } = renderer;
const none = { load: async () => undefined };
const ids = readdirSync(dir).filter((f) => f.endsWith('.pen')).sort().slice(Number(first), Number(first) + Number(count));
const W = 420, H = 262, PAD = 10;
const surface = ck.MakeSurface(PAD + 2 * (W + PAD), PAD + ids.length * (H + PAD))!;
const c = surface.getCanvas();
c.clear(ck.Color(40, 40, 44, 1));
for (const [row, f] of ids.entries()) {
  const id = f.replace(/\.pen$/, '');
  const y = PAD + row * (H + PAD);
  const ref = join(previews, `${id}.jpg`);
  if (existsSync(ref)) {
    const img = ck.MakeImageFromEncoded(readFileSync(ref))!;
    c.drawImageRect(img, ck.LTRBRect(0, 0, img.width(), img.height()), ck.LTRBRect(PAD, y, PAD + W, y + H), new ck.Paint());
    img.delete();
  }
  const doc = new PenDoc(parsePen(readFileSync(join(dir, f), 'utf8')));
  const parts = [];
  for (const n of doc.data.children) {
    const scene = buildScene(doc, n);
    if (!scene) continue;
    const p = await renderer.prepare(scene, none);
    const b = p.layout.box(scene);
    p.dispose();
    parts.push({ scene, b });
  }
  const x0 = Math.min(...parts.map((p) => p.b.x)), y0 = Math.min(...parts.map((p) => p.b.y));
  const x1 = Math.max(...parts.map((p) => p.b.x + p.b.width)), y1 = Math.max(...parts.map((p) => p.b.y + p.b.height));
  const root: SceneNode = { id: 'r', type: 'frame', layout: 'none', x: 0, y: 0, width: x1 - x0, height: y1 - y0, children: parts.map((p) => ({ ...p.scene, x: p.b.x - x0, y: p.b.y - y0 })) };
  const scale = Math.min(W / (x1 - x0), H / (y1 - y0));
  const png = await renderer.renderNode(root, root, none, { scale });
  const img = ck.MakeImageFromEncoded(png)!;
  c.drawImage(img, PAD + W + PAD + (W - img.width()) / 2, y + (H - img.height()) / 2);
  img.delete();
  console.log(row, id, `${Math.round(x1 - x0)}x${Math.round(y1 - y0)}`);
}
writeFileSync(out, surface.makeImageSnapshot().encodeToBytes()!);
