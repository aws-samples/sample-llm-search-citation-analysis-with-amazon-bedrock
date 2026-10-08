import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['lib/**/*.spec.ts'],
    globals: true,
    testTimeout: 30_000,
    // Removes the cdk.out* folders each synthesized test stack leaves in the OS temp dir.
    globalSetup: ['lib/test-support/cleanup-synth-output.ts'],
  },
});
