import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parseSvgIcon, phosphorWeight, type IconGeometry, type IconSource } from './icons.ts';

const require = createRequire(import.meta.url);

/** Root folder of an installed package (some packages do not export their package.json). */
function packageDir(name: string): string {
  let dir = path.dirname(require.resolve(name));
  while (!existsSync(path.join(dir, 'package.json')) || !dir.endsWith(path.join('node_modules', name))) {
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`cannot find the folder of ${name}`);
    dir = up;
  }
  return dir;
}

const lucideDir = path.join(packageDir('lucide-static'), 'icons');
const phosphorDir = path.join(packageDir('@phosphor-icons/core'), 'assets');

/**
 * Icons from the installed npm packages. lucide also answers for `feather`: lucide began as a fork of
 * Feather and keeps the Feather names as aliases.
 */
export class PackageIconSource implements IconSource {
  private cache = new Map<string, Promise<IconGeometry | undefined>>();

  load(library: string, name: string, weight: number | undefined): Promise<IconGeometry | undefined> {
    const file = this.file(library, name, weight);
    if (!file) return Promise.resolve(undefined);
    let p = this.cache.get(file);
    if (!p) {
      p = fs.readFile(file, 'utf8').then(parseSvgIcon, (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') return undefined;
        throw err;
      });
      this.cache.set(file, p);
    }
    return p;
  }

  private file(library: string, name: string, weight: number | undefined): string | undefined {
    if (!/^[\w-]+$/.test(name)) return undefined;
    const lib = library.toLowerCase();
    if (lib === 'lucide' || lib === 'feather') return path.join(lucideDir, `${name}.svg`);
    if (lib === 'phosphor') {
      const w = phosphorWeight(weight);
      return path.join(phosphorDir, w, w === 'regular' ? `${name}.svg` : `${name}-${w}.svg`);
    }
    return undefined;
  }
}
