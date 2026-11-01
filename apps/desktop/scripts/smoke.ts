// Start the packaged app (out/nib-<platform>-<arch>) with its smoke test and check that its daemon and
// pages came up: node apps/desktop/scripts/smoke.ts. On Linux run it under xvfb-run.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const exe = {
  darwin: join(root, 'out', `nib-darwin-${arch}`, 'nib.app', 'Contents', 'MacOS', 'nib'),
  win32: join(root, 'out', `nib-win32-${arch}`, 'nib.exe'),
  linux: join(root, 'out', `nib-linux-${arch}`, 'nib'),
}[process.platform as 'darwin' | 'win32' | 'linux'];
if (!exe || !existsSync(exe)) throw new Error(`no packaged app at ${exe}: run pnpm package:desktop first`);
const dir = await mkdtemp(join(tmpdir(), 'nib-smoke-'));
const report = join(dir, 'report');
// Its own home, port and profile, so it never meets another nib; the daemon it starts stops soon after.
execFileSync(exe, [`--user-data-dir=${join(dir, 'profile')}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : [])], {
  stdio: 'inherit', timeout: 120_000,
  env: { ...process.env, NIB_HOME: join(dir, 'home'), NIB_PORT: '7499', NIB_IDLE_MS: '10000', NIB_DESKTOP_SMOKE: report },
});
const text = await readFile(join(report, 'report.json'), 'utf8');
// Its daemon stops by itself once idle; the folder holds nothing else of use.
await rm(dir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
const r = JSON.parse(text) as { daemon?: number; dashboard?: { bridge?: string; text?: string }; settings?: { bridge?: string } };
const ok = typeof r.daemon === 'number' && r.dashboard?.bridge === 'object' && r.settings?.bridge === 'object' && !!r.dashboard.text?.trim();
console.log(ok ? `The app started its daemon (port ${r.daemon}) and showed its pages.` : `The app did not come up: ${JSON.stringify(r).slice(0, 600)}`);
process.exit(ok ? 0 : 1);
