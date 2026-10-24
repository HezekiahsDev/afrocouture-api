import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Every suite truncates the same database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
