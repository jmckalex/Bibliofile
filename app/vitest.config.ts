import { defineConfig } from 'vitest/config';

// Headless tests for the pure main-process logic (document-service). The Electron
// shell + renderer are not unit-tested here; they're covered by the dev smoke test.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    passWithNoTests: true,
  },
});
