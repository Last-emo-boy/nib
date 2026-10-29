// Render every top-level frame of the corpus projects that have pen.dev PNG exports, match each export to
// a frame (by leading number, then size), and write side-by-side sheets: pen.dev left, nib right.
//   node scripts/oracle-check.ts <outDir> [project...]
import fs from 'node:fs';
import path from 'node:path';
import { buildScene, PenDoc } from '@nib/core';
import { parsePen } from '@nib/format';
import { loadCanvasKit } from '@nib/render';
import { createNodeRenderer, imagesFor } from '@nib/render/node';

const PROJECTS: Record<string, string> = {
  'aris-lab': 'aris-lab/design/aris-lab-ui.pen',
  inkwords: 'inkwords/design/inkwords-ui.pen',
  mactoys: 'mactoys/design/mactoys.pen',
  'silicon-agent': 'silicon-agent/design/silicon-agent-ui.pen',
};
const ROOT = path.join(process.env.HOME!, 'Playground');
const [outDir, ...only] = process.argv.slice(2);
const ck = await loadCanvasKit();
const renderer = await createNodeRenderer();
fs.mkdirSync(outDir, { recursive: true });

function pixels(img: ReturnType<typeof ck.MakeImageFromEncoded> & object) {
  return img.readPixels(0, 0, { width: img.width(), height: img.height(), colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }) as Uint8Array;
}

/** Mean channel difference over a sparse grid, both images composited over white. */
function meanDelta(a: Uint8Array, b: Uint8Array, aw: number, h: number, w: number): number {
  let sum = 0, n = 0;
  const bw = w;
  for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
    const i = (y * aw + x) * 4, j = (y * bw + x) * 4;
    for (let c = 0; c < 3; c++) {
      const va = a[i + c] * a[i + 3] / 255 + 255 - a[i + 3], vb = b[j + c] * b[j + 3] / 255 + 255 - b[j + 3];
      sum += Math.abs(va - vb);
    }
    n++;
  }
  return sum / n;
}

const lead = (s: string) => /^(\d+[a-z]?)/i.exec(s.trim())?.[1]?.toLowerCase();

for (const [project, rel] of Object.entries(PROJECTS)) {
  if (only.length && !only.includes(project)) continue;
  const file = path.join(ROOT, rel);
  const exportsDir = path.join(path.dirname(file), 'exports');
  const doc = new PenDoc(parsePen(fs.readFileSync(file, 'utf8')));
  const images = imagesFor(file);
  const frames = doc.data.children.map((n) => ({ node: n, name: n.name ?? n.id, key: lead(n.name ?? '') }));
  for (const png of fs.readdirSync(exportsDir).filter((f) => f.endsWith('.png')).sort()) {
    const expected = ck.MakeImageFromEncoded(fs.readFileSync(path.join(exportsDir, png)))!;
    const ew = expected.width(), eh = expected.height();
    const key = lead(png);
    const scenes = frames.map((f) => ({ ...f, scene: buildScene(doc, f.node) })).filter((f) => f.scene);
    // Prefer a frame with the same leading number; otherwise the same-size frame that looks most alike.
    let match = key ? scenes.find((f) => f.key === key) : undefined;
    if (!match) {
      let best = Infinity;
      const ePx = pixels(expected);
      for (const f of scenes) {
        const prep = await renderer.prepare(f.scene!, images);
        const b = prep.layout.box(f.scene!);
        prep.dispose();
        if (Math.abs(b.width - ew) > 2 || Math.abs(b.height - eh) > 20) continue;
        const img = ck.MakeImageFromEncoded(await renderer.renderPNG(f.scene!, images))!;
        const d = meanDelta(ePx, pixels(img), ew, Math.min(eh, img.height()), Math.min(ew, img.width()));
        img.delete();
        if (d < best) { best = d; match = f; }
      }
    }
    if (!match) { console.log(`${project}/${png}: no matching frame`); continue; }
    const actualPng = await renderer.renderPNG(match.scene!, images);
    const actual = ck.MakeImageFromEncoded(actualPng)!;
    const aw = actual.width(), ah = actual.height();
    const gap = 16;
    const surface = ck.MakeSurface(ew + gap + aw, Math.max(eh, ah))!;
    const c = surface.getCanvas();
    c.clear(ck.Color(255, 0, 255, 1));
    c.drawImage(expected, 0, 0);
    c.drawImage(actual, ew + gap, 0);
    const out = path.join(outDir, `${project}-${png}`);
    fs.writeFileSync(out, surface.makeImageSnapshot().encodeToBytes()!);
    fs.writeFileSync(path.join(outDir, `${project}-${png.replace(/\.png$/, '')}.nib.png`), actualPng);
    console.log(`${project}/${png} -> "${match.name}" pen ${ew}x${eh} nib ${aw}x${ah}`);
    surface.delete();
  }
  console.log(project, JSON.stringify(renderer.report(images)));
}
