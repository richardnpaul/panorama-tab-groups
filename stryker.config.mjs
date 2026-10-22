// Mutation testing. `mutate` lists source files with positive globs only; a file
// is added here once it reaches a 100% mutation score. Negated globs are forbidden
// (scripts/check-no-suppressions.mjs).
// `MUTATE=src/a.ts,src/b.ts npm run test:mutation` narrows a run while iterating
const only = process.env.MUTATE?.split(',');

export default {
  testRunner: 'vitest',
  vitest: { configFile: 'vitest.config.mjs' },
  checkers: ['typescript'],
  tsconfigFile: 'tsconfig.json',
  plugins: [
    '@stryker-mutator/vitest-runner',
    '@stryker-mutator/typescript-checker',
  ],
  mutate: only ?? [
    'scripts/**/*.mjs',
    'tools/adbkit-stub/index.js',
    'src/js/background/constants.ts',
    'src/js/background/utils.ts',
    'src/js/view/tabs.ts',
    'src/js/share/options.ts',
    'src/js/share/utils.ts',
    'src/js/share/dom.ts',
    'src/js/share/guards.ts',
    'src/js/options/reset.ts',
    'src/js/options/toolbar.ts',
    'src/js/options/theme.ts',
    'src/js/options/view.ts',
    'src/js/options/statistics.ts',
    'src/js/options/shortcuts.ts',
    'src/js/options/translations.ts',
    'src/js/options/native-groups.ts',
    'src/js/options/index.ts',
    'src/js/share/capabilities.ts',
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
    'reports',
  ],
};
