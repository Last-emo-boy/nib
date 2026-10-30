// Build the design-system libraries nib ships into packages/daemon/libraries: <id>.lib.pen and catalog.json.
// node scripts/build-libraries.ts [sheet dir]   (with a dir, also renders every board in each mode for review)
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScene, expandTree, PenDoc, type ExpandIssue } from '@nib/core';
import { parsePen, serializePen, validateNode, type Issue, type Node, type PenDocument } from '@nib/format';
import { createNodeRenderer } from '@nib/render/node';
import type { Library } from './libraries/kit.ts';
import * as antd from './libraries/antd.ts';
import * as heroui from './libraries/heroui.ts';
import * as material from './libraries/material.ts';
import * as radix from './libraries/radix.ts';
import * as shadcn from './libraries/shadcn.ts';

const LIBRARIES = [{ meta: shadcn.meta, build: shadcn.shadcn, code: shadcn.codeMeta }, { meta: heroui.meta, build: heroui.heroui, code: heroui.codeMeta }, { meta: antd.meta, build: antd.antd, code: antd.codeMeta }, { meta: radix.meta, build: radix.radix, code: radix.codeMeta }, { meta: material.meta, build: material.material, code: material.codeMeta }];
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'packages', 'daemon', 'libraries');
const GAP = 160;

const [sheetDir] = process.argv.slice(2);
const renderer = await createNodeRenderer();
const none = { load: async () => undefined };

/** Every `$name` a document uses that it does not define. */
function undefinedVariables(doc: PenDocument): string[] {
  const missing = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === 'string' && v.startsWith('$') && !(v.slice(1) in (doc.variables ?? {}))) missing.add(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (k !== 'content') visit(x);
  };
  visit(doc.children);
  return [...missing];
}

/** Place boards in columns, each next board under the shortest column, using their laid-out sizes. */
async function arrange(doc: PenDoc, columns: number): Promise<void> {
  const cols = Array.from({ length: columns }, () => ({ x: 0, y: 0, width: 0, boards: [] as Node[] }));
  const size = new Map<Node, { width: number; height: number }>();
  for (const b of doc.data.children) {
    const scene = buildScene(doc, b)!;
    const p = await renderer.prepare(scene, none);
    const box = p.layout.box(scene);
    p.dispose();
    size.set(b, { width: box.width, height: box.height });
    const c = cols.reduce((a, c) => (c.y < a.y ? c : a));
    c.boards.push(b);
    c.y += box.height + GAP;
    c.width = Math.max(c.width, box.width);
  }
  let x = 0;
  for (const c of cols) {
    let y = 0;
    for (const b of c.boards) { Object.assign(b, { x, y }); y += size.get(b)!.height + GAP; }
    x += c.width + GAP;
  }
}

const catalog = [];
for (const { meta, build, code } of LIBRARIES) {
  const lib: Library = build();
  const data = lib.document();
  const doc = new PenDoc(parsePen(serializePen(data)));
  await arrange(doc, 3);

  const issues: Issue[] = [];
  const expand: ExpandIssue[] = [];
  for (const n of doc.data.children) {
    validateNode(n, {}, issues);
    expandTree(doc, n, { issues: expand });
  }
  const problems = [
    ...issues.map((i) => `${i.level}: ${i.path}: ${i.message}`),
    ...expand.map((i) => `instance ${i.instance}: ${i.message}`),
    ...undefinedVariables(doc.data).map((v) => `undefined variable ${v}`),
  ];
  for (const p of problems) console.log(`  ${meta.id}: ${p}`);
  if (issues.some((i) => i.level === 'error') || expand.length) throw new Error(`${meta.id} has errors`);

  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${meta.id}.lib.pen`), serializePen(doc.data));
  writeFileSync(join(OUT, `${meta.id}.code.json`), `${JSON.stringify(lib.codeMap(code), null, 2)}\n`);
  // The license of the design system each library follows travels with it.
  copyFileSync(join(HERE, 'libraries', 'licenses', `${meta.id}-LICENSE.txt`), join(OUT, `${meta.id}-LICENSE.txt`));
  catalog.push({ ...meta, components: lib.components.size, themes: lib.themes });
  console.log(`${meta.id}: ${lib.components.size} components, ${doc.data.children.length} boards`);

  if (sheetDir) {
    const dir = join(sheetDir, meta.id);
    mkdirSync(dir, { recursive: true });
    for (const mode of lib.themes.Mode ?? ['']) {
      for (const b of doc.data.children) {
        const scene = buildScene(doc, b, mode ? { theme: { Mode: mode } } : {})!;
        writeFileSync(join(dir, `${b.id}-${mode || 'default'}.png`), await renderer.renderPNG(scene, none));
      }
    }
  }
}
writeFileSync(join(OUT, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify(renderer.report(none)));
