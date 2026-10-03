import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Integration tests talk to the live API and are slow by nature.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
