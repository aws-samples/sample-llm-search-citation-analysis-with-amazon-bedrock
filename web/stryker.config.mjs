// Targeted mutation testing for the dashboard (Stryker + the vitest runner).
//
//   npm run mutation -- --mutate src/hooks/useAnalysisEndpoint.ts
//   npm run mutation -- --mutate 'src/formatting/**/*.ts'
//
// Stryker rewrites the selected files one mutation at a time and runs the
// specs that cover each mutated line. A survivor means either no spec pins
// that behaviour or the statement has no observable effect — the class of
// dead code no reference-based tool can see. A whole-tree run is long; one
// module against its specs is minutes, so this is a scheduled / per-PR-when-
// relevant job, not part of `npm run validate`. For each survivor decide: add
// the spec that kills it, or delete the statement it proves inert.
//
// `mutate` here is the default scope when no --mutate is given; always pass
// --mutate for a targeted run.

export default {
  testRunner: 'vitest',
  vitest: {configFile: 'vite.config.ts',},
  mutate: [
    'src/**/*.ts',
    'src/**/*.tsx',
    '!src/**/*.spec.ts',
    '!src/**/*.spec.tsx',
    '!src/**/*-fixtures.ts',
    '!src/**/*-fixtures.tsx',
    '!src/**/*Fixtures.ts',
    '!src/test/**',
    '!src/types/**',
    '!src/main.tsx',
  ],
  // Only the specs covering a mutated line run for that mutant.
  coverageAnalysis: 'perTest',
  reporters: ['clear-text', 'progress'],
  clearTextReporter: {
    allowColor: false,
    logTests: false,
    reportTests: false 
  },
  tempDirName: '.stryker-tmp',
  ignorePatterns: ['dist', 'coverage', 'reports'],
  // Keep the per-mutant time bound generous: jsdom specs are slow to boot.
  timeoutMS: 20000,
  timeoutFactor: 2,
};
