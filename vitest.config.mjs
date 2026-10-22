export default {
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.{js,ts}', 'tools/**/*.test.js'],
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.{js,ts}', 'scripts/**/*.mjs', 'tools/**/*.js'],
      reporter: ['text', 'lcov'],
    },
  },
};
