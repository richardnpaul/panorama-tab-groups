// Mutation testing. `mutate` covers all the source with positive globs only;
// negated globs are forbidden (scripts/check-no-suppressions.ts).
// `MUTATE=src/a.ts,src/b.ts npm run test:mutation` narrows a run while iterating
const only = process.env.MUTATE?.split(',');

export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.ts' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  mutate: only ?? [
    'scripts/**/*.ts',
    'tools/adbkit-stub/index.js',
    'src/**/*.ts',
  ],
  coverageAnalysis: 'perTest',
  thresholds: { high: 100, low: 100, break: 100 },
  reporters: ['clear-text', 'progress', 'html'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  incremental: true,
  incrementalFile: 'reports/stryker-incremental.json',
  // Only controls what is copied into Stryker's sandbox, never what is mutated
  ignorePatterns: [
    'test-user-data-*',
    'playwright-report',
    'test-results',
    'coverage',
    'dist',
    'dist-firefox',
    'reports',
  ],
};
