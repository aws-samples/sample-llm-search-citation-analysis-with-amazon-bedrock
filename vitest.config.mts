import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lib/**/*.spec.ts'],
    globals: true,
    testTimeout: 30_000,
  },
});
