// Where the Windows build starts. A zip cannot hold the links that let nib's packages import each other by
// name (node_modules/@nib/<name> -> packages/<name>), so they are made here, as directory junctions (which
// need no special rights), before the app loads; again when the folder has moved since.
import { mkdirSync, readdirSync, realpathSync, symlinkSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const scope = join(root, 'node_modules', '@nib');
mkdirSync(scope, { recursive: true });
for (const name of readdirSync(join(root, 'packages'))) {
  const target = join(root, 'packages', name), link = join(scope, name);
  let current = false;
  try { current = realpathSync(link) === realpathSync(target); } catch { /* missing, or pointing where the folder was */ }
  if (current) continue;
  try { unlinkSync(link); } catch { /* nothing there */ }
  symlinkSync(target, link, 'junction');
}
await import('./main.ts');
