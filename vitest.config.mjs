export default {
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.{js,ts}'],
    coverage: {
      provider: 'istanbul',
      include: ['src/js/**/*.{js,ts}'],
      exclude: ['src/js/depends/**'],
      reporter: ['text', 'lcov'],
    },
  },
};
