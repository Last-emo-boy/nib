import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    // Tests never touch the user's ~/.nib (daemon info, recents, drafts, thumbnails).
    env: { NIB_HOME: join(tmpdir(), `nib-test-home-${process.pid}`) },
  },
});
