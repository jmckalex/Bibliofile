import { defineConfig } from 'vitest/config';

// Root config: run `pnpm test` to execute every package's tests at once.
export default defineConfig({
  test: {
    include: ['{core,shared,plugins-sdk,app}/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**'],
    passWithNoTests: true,
  },
});
