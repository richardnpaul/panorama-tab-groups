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
    'no-console': 'warn',
    'no-param-reassign': 'off',
    'no-alert': 'off',
    'import/no-cycle': 'off',
    'operator-linebreak': 'off',
    'implicit-arrow-linebreak': 'off',
    'function-paren-newline': 'off',
    'class-methods-use-this': 'warn',
    'no-restricted-syntax': ['error', 'WithStatement'],
    'import/extensions': [
      'error',
      'ignorePackages',
      {
        js: 'always',
      },
    ],
  },
  globals: {
    browser: 'readonly',
  },
};
