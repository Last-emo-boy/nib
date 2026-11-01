// The design-diff action: `nib diff` for each changed .pen file of the pull request, one comment with what
// changed, and the pictures either on a branch (shown in the comment) or in an artifact (linked).
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const env = process.env;
const root = resolve(env.NIB_ROOT ?? '.');
const cli = join(root, 'packages', 'cli', 'src', 'main.ts');
const out = join(env.RUNNER_TEMP ?? tmpdir(), 'nib-design-diff');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const marker = '<!-- nib-design-diff -->';
const dry = env.NIB_DRY_RUN === '1';

const base = env.BASE_SHA || 'HEAD~1';
const files = (env.NIB_FILES ? env.NIB_FILES.split(/\s+/) : git('diff', '--name-only', '--diff-filter=AM', `${base}...${env.HEAD_SHA || 'HEAD'}`, '--', '*.pen').split('\n')).filter((f) => f.endsWith('.pen'));
const output = (k, v) => { if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${k}=${v}\n`); };
if (!files.length) { console.log('No .pen files changed.'); output('changed', 'false'); process.exit(0); }

rmSync(out, { recursive: true, force: true });
const sections = [];
for (const file of files) {
  const dir = join(out, file.replace(/[^\w.-]+/g, '_').replace(/\.pen$/, ''));
  mkdirSync(dir, { recursive: true });
  const md = join(dir, 'summary.md');
  try {
    // A file the pull request adds has no base version: everything in it is new.
    const existed = (() => { try { git('cat-file', '-e', `${base}:${file}`); return true; } catch { return false; } })();
    if (existed) execFileSync(process.execPath, [cli, 'diff', file, '--from', base, '--images', dir, '--markdown', md], { stdio: 'inherit' });
    else writeFileSync(md, `### Design changes in ${file}\n\n**A new design.**\n`);
    sections.push({ file, dir, text: readFileSync(md, 'utf8') });
  } catch (e) {
    sections.push({ file, dir, text: `### ${file}\n\nnib could not compare it: ${e.message}\n` });
  }
}

// Pictures on a branch: links rewritten to where they will be.
let note = '';
const branch = env.NIB_IMAGES_BRANCH;
if (branch && !dry) {
  const at = `pr-${env.PR_NUMBER ?? 'local'}/${(env.HEAD_SHA || 'head').slice(0, 12)}`;
  const work = join(env.RUNNER_TEMP ?? tmpdir(), 'nib-images-branch');
  rmSync(work, { recursive: true, force: true });
  const remote = `https://x-access-token:${env.GH_TOKEN}@github.com/${env.REPO}.git`;
  try { execFileSync('git', ['clone', '--depth', '1', '--branch', branch, remote, work], { stdio: 'ignore' }); }
  catch { mkdirSync(work, { recursive: true }); execFileSync('git', ['-C', work, 'init', '-q', '-b', branch]); execFileSync('git', ['-C', work, 'remote', 'add', 'origin', remote]); }
  for (const s of sections) {
    const dest = join(work, at, relative(out, s.dir));
    mkdirSync(dest, { recursive: true });
    for (const f of readdirSync(s.dir).filter((x) => x.endsWith('.png'))) writeFileSync(join(dest, f), readFileSync(join(s.dir, f)));
    const url = `https://raw.githubusercontent.com/${env.REPO}/${branch}/${at}/${relative(out, s.dir)}`;
    s.text = s.text.replace(/\]\(([^)]+\.png)\)/g, (_m, f) => `](${url}/${f})`);
  }
  execFileSync('git', ['-C', work, 'add', '-A']);
  execFileSync('git', ['-C', work, '-c', 'user.name=nib', '-c', 'user.email=nib@users.noreply.github.com', 'commit', '-q', '-m', `Design diff pictures for ${at}`]);
  execFileSync('git', ['-C', work, 'push', '-q', 'origin', branch]);
} else {
  // Pictures in the artifact: the comment shows the summary and links to it.
  for (const s of sections) s.text = s.text.split('\n').filter((l) => !l.startsWith('|')).join('\n').replace(/\n{3,}/g, '\n\n');
  note = env.RUN_URL ? `\nThe pictures (before, after, difference) are in the [nib-design-diff artifact](${env.RUN_URL}).\n` : '';
}

const body = `${marker}\n## nib design diff\n\n${sections.map((s) => s.text).join('\n')}${note}`;
output('changed', 'true');
if (dry || !env.PR_NUMBER) { console.log(body); process.exit(0); }
// One comment per pull request, updated on each push.
const gh = (...args) => execFileSync('gh', args, { encoding: 'utf8', env: { ...env, GH_TOKEN: env.GH_TOKEN } });
const comments = JSON.parse(gh('api', `repos/${env.REPO}/issues/${env.PR_NUMBER}/comments`, '--paginate'));
const mine = comments.find((c) => c.body?.startsWith(marker));
const payload = join(out, 'comment.json');
writeFileSync(payload, JSON.stringify({ body }));
if (mine) gh('api', '-X', 'PATCH', `repos/${env.REPO}/issues/comments/${mine.id}`, '--input', payload);
else gh('api', '-X', 'POST', `repos/${env.REPO}/issues/${env.PR_NUMBER}/comments`, '--input', payload);
console.log(mine ? 'Updated the design diff comment.' : 'Posted the design diff comment.');
