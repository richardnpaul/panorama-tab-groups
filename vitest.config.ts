import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tools/**/*.test.ts'],
    coverage: {
      provider: 'istanbul',
      include: [
        'src/**/*.ts',
        'scripts/**/*.ts',
        'tools/**/*.js',
        'tools/oxlint/**/*.ts',
      ],
      reporter: ['text', 'lcov'],
      // The run fails below 100% on every metric
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
