// airbnb's list, which an override of the rule would otherwise replace
const airbnbRestrictedGlobals =
  require('eslint-config-airbnb-base/rules/variables').rules[
    'no-restricted-globals'
  ].slice(1);

const ONLY_THROUGH_ADAPTERS =
  'The browser is reached through a port; only an adapter or a composition root names it (see .eslintrc.js)';

module.exports = {
  env: {
    browser: true,
    es2021: true,
    webextensions: true,
  },
  extends: ['airbnb-base', 'plugin:json/recommended', 'prettier'],
  plugins: ['json'],
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
  rules: {
    'no-console': 'off',
    'no-param-reassign': 'off',
    'no-alert': 'off',
    'import/no-cycle': 'off',
    'operator-linebreak': 'off',
    'implicit-arrow-linebreak': 'off',
    'function-paren-newline': 'off',
    'class-methods-use-this': 'warn',
    'no-restricted-syntax': ['error', 'WithStatement'],
    // Imports keep their emitted `.js` specifier; `.ts` specifiers are forbidden
    'import/extensions': [
      'error',
      'ignorePackages',
      {
        js: 'always',
        ts: 'never',
      },
    ],
  },
  settings: {
    'import/resolver': {
      typescript: { project: './tsconfig.json' },
      node: {},
    },
  },
  globals: {
    browser: 'readonly',
  },
  overrides: [
    {
      // The configuration of a test runner imports it, which is all it is for
      files: ['playwright.config.ts', 'vitest.config.ts'],
      rules: {
        'import/no-extraneous-dependencies': [
          'error',
          { devDependencies: true },
        ],
      },
    },
    {
      // The stub is a package of its own, but its test runs with the root's dev dependencies
      files: ['tools/adbkit-stub/index.test.ts'],
      rules: {
        'import/no-extraneous-dependencies': [
          'error',
          { devDependencies: true, packageDir: [__dirname] },
        ],
      },
    },
    {
      // The architecture written down: outside these files the extension reaches
      // the browser only through the ports. The adapters implement them, the
      // polyfill fills in what a browser lacks, and the composition roots build
      // the adapters over the browser. Adding a file here is reviewed like code.
      files: ['src/**/*.ts'],
      excludedFiles: [
        'src/js/adapters/**',
        'src/js/polyfill.ts',
        'src/js/background/main.ts',
        'src/js/background/compose.ts',
        'src/js/background/StateManager.ts',
        'src/js/background/menu-manager.ts',
        'src/js/view/start.ts',
        'src/popup-view/start.ts',
        'src/js/options/start.ts',
        'src/js/migration-status/start.ts',
      ],
      rules: {
        'no-restricted-globals': [
          'error',
          ...airbnbRestrictedGlobals,
          { name: 'browser', message: ONLY_THROUGH_ADAPTERS },
          { name: 'chrome', message: ONLY_THROUGH_ADAPTERS },
        ],
        'no-restricted-syntax': [
          'error',
          'WithStatement',
          {
            selector: 'MemberExpression[property.name=/^(storage|sessions)$/]',
            message: ONLY_THROUGH_ADAPTERS,
          },
        ],
      },
    },
    {
      files: ['**/*.ts'],
      parser: '@typescript-eslint/parser',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
      plugins: ['@typescript-eslint'],
      extends: [
        'plugin:@typescript-eslint/strict-type-checked',
        'plugin:@typescript-eslint/stylistic-type-checked',
        'prettier',
      ],
      rules: {
        // Named exports are the convention for TypeScript modules
        'import/prefer-default-export': 'off',
        // The same setting airbnb uses for the base rule: leaving a property out
        // with a rest pattern is not an unused variable
        '@typescript-eslint/no-unused-vars': [
          'error',
          { ignoreRestSiblings: true },
        ],
        '@typescript-eslint/consistent-type-assertions': [
          'error',
          { assertionStyle: 'never' },
        ],
      },
    },
  ],
};
