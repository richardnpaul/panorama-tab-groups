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
        '@typescript-eslint/consistent-type-assertions': [
          'error',
          { assertionStyle: 'never' },
        ],
      },
    },
    {
      files: ['tests/unit/**/*.js', 'tools/**/*.test.js'],
      globals: {
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        beforeEach: 'readonly',
        afterAll: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  ],
};
