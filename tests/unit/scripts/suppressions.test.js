import { vi } from 'vitest';
import {
  ALLOWED_IGNORE_ENTRIES,
  ALLOWED_SANDBOX_IGNORES,
  CODE_EXTENSIONS,
  COMMENT_SUPPRESSIONS,
  HOOK_CONFIG_FILE,
  IGNORE_FILES,
  STRYKER_CONFIG_FILE,
  VITEST_CONFIG_FILE,
  checkSuppressions,
  collectViolationCounts,
  compareWithAllowlist,
  countCommentSuppressions,
  listDisallowedIgnoreEntries,
  listHookExcludes,
  listStrykerViolations,
  listTsconfigViolations,
  listVitestViolations,
} from '../../../scripts/lib/suppressions.mjs';

// The trigger phrases are assembled at runtime so this file does not trip the guard
const phrase = (...words) => words.join(' ');
const SAMPLES = {
  'coverage-istanbul': phrase('/*', 'istanbul', 'ignore', 'next */'),
  'coverage-c8': phrase('/*', 'c8', 'ignore', 'next */'),
  'coverage-v8': phrase('/*', 'v8', 'ignore', 'next */'),
  mutation: phrase('//', 'Stryker', 'disable', 'next-line'),
  'types-ignore': phrase('//', ['@ts', 'ignore'].join('-')),
  'types-expect-error': phrase('//', ['@ts', 'expect', 'error'].join('-')),
  'types-nocheck': phrase('//', ['@ts', 'nocheck'].join('-')),
  lint: phrase('//', ['eslint', 'disable', 'next', 'line'].join('-'), 'rule'),
};

describe('scripts/lib/suppressions.mjs', () => {
  describe('constants', () => {
    it('lists every comment suppression kind the guard knows about', () => {
      expect(COMMENT_SUPPRESSIONS.map(({ kind }) => kind)).toEqual([
        'coverage-istanbul',
        'coverage-c8',
        'coverage-v8',
        'mutation',
        'types-ignore',
        'types-expect-error',
        'types-nocheck',
        'lint',
      ]);
    });

    it('scans only code files', () => {
      expect(CODE_EXTENSIONS).toEqual(['.js', '.mjs', '.cjs', '.ts']);
    });

    it('allows only generated or tool output in ignore files', () => {
      expect(ALLOWED_IGNORE_ENTRIES).toEqual([
        '!.eslintrc.js',
        'build',
        'dist',
        'node_modules',
        'coverage',
        'coverage/',
        'playwright-report',
        'playwright-report/',
        'test-results',
        'test-results/',
        'test-user-data*',
        'web-ext-artifacts',
        '.stryker-tmp',
      ]);
    });

    it('allows only non-source folders in the Stryker sandbox ignores', () => {
      expect(ALLOWED_SANDBOX_IGNORES).toEqual([
        'test-user-data-*',
        'playwright-report',
        'test-results',
        'coverage',
        'dist',
        'reports',
      ]);
    });

    it('names the config files it inspects', () => {
      expect(IGNORE_FILES).toEqual(['.eslintignore', '.prettierignore']);
      expect(HOOK_CONFIG_FILE).toBe('.pre-commit-config.yaml');
      expect(VITEST_CONFIG_FILE).toBe('vitest.config.mjs');
      expect(STRYKER_CONFIG_FILE).toBe('stryker.config.mjs');
    });
  });

  describe('countCommentSuppressions', () => {
    it.each(Object.entries(SAMPLES))('detects %s', (kind, sample) => {
      expect(countCommentSuppressions(`const a = 1; ${sample}\n`)).toEqual({
        [kind]: 1,
      });
    });

    it('returns an empty object for clean code', () => {
      expect(
        countCommentSuppressions('const a = 1;\n// a normal comment'),
      ).toEqual({});
    });

    it('does not trigger on the bare tool names', () => {
      expect(
        countCommentSuppressions('istanbul c8 v8 stryker eslint ts-check'),
      ).toEqual({});
    });

    it('counts every occurrence per kind', () => {
      const text = [
        SAMPLES.lint,
        'x',
        SAMPLES.lint,
        SAMPLES['coverage-c8'],
      ].join('\n');

      expect(countCommentSuppressions(text)).toEqual({
        lint: 2,
        'coverage-c8': 1,
      });
    });

    it('matches the mutation directive case-insensitively and with a hyphen', () => {
      expect(
        countCommentSuppressions(phrase('//', 'stryker', 'disable')),
      ).toEqual({ mutation: 1 });
      expect(
        countCommentSuppressions(`// ${['stryker', 'disable'].join('-')}-line`),
      ).toEqual({
        mutation: 1,
      });
    });

    it('accepts any amount of whitespace between the words of a directive', () => {
      expect(
        countCommentSuppressions(
          [
            ['istanbul', 'ignore'].join('   '),
            ['c8', 'ignore'].join('\t\t'),
            ['v8', 'ignore'].join('  '),
          ].join('\n'),
        ),
      ).toEqual({
        'coverage-istanbul': 1,
        'coverage-c8': 1,
        'coverage-v8': 1,
      });
    });

    it('accepts mixed whitespace and hyphens in the mutation directive', () => {
      expect(
        countCommentSuppressions(['stryker', 'disable'].join(' - ')),
      ).toEqual({ mutation: 1 });
      expect(
        countCommentSuppressions(['stryker', 'disable'].join('--')),
      ).toEqual({ mutation: 1 });
    });

    it('requires whitespace between the words of coverage directives', () => {
      expect(
        countCommentSuppressions('istanbulignore c8ignore v8ignore'),
      ).toEqual({});
    });
  });

  describe('listDisallowedIgnoreEntries', () => {
    it('returns entries that are not generated output', () => {
      const text = ['node_modules', 'src/popup-view/*', 'coverage/'].join('\n');

      expect(listDisallowedIgnoreEntries(text)).toEqual(['src/popup-view/*']);
    });

    it('ignores comments, blank lines and surrounding whitespace', () => {
      const text = '# a comment\n\n   dist   \n  src/a.js  \n';

      expect(listDisallowedIgnoreEntries(text)).toEqual(['src/a.js']);
    });

    it('returns nothing when every entry is allowed', () => {
      expect(
        listDisallowedIgnoreEntries(ALLOWED_IGNORE_ENTRIES.join('\n')),
      ).toEqual([]);
    });
  });

  describe('listHookExcludes', () => {
    const yaml = [
      'repos:',
      '  - repo: local',
      '    hooks:',
      '      - id: eslint',
      '        entry: npx eslint',
      '        files: \\.(js|mjs|ts|json)$',
      '        exclude: |',
      '          (?x)^(',
      '            src/popup-view/.*|',
      '            tests/old/fixture\\.js|',
      '            scripts/legacy.mjs',
      '          )$',
    ].join('\n');

    it('returns the source paths excluded from a hook', () => {
      expect(listHookExcludes(yaml)).toEqual([
        'src/popup-view/.*',
        'tests/old/fixture\\.js',
        'scripts/legacy.mjs',
      ]);
    });

    it('ignores paths that are not at the start of a line', () => {
      const text = [
        '        entry: npx eslint src/js/a.js',
        '        args: [--config, tests/x.json]',
      ].join('\n');

      expect(listHookExcludes(text)).toEqual([]);
    });

    it('returns nothing for a config without source excludes', () => {
      expect(listHookExcludes('repos:\n  - repo: local\n')).toEqual([]);
    });
  });

  describe('config checks', () => {
    it('flags a tsconfig exclude list', () => {
      expect(listTsconfigViolations({ exclude: ['src/x'] })).toEqual([
        'exclude',
      ]);
      expect(listTsconfigViolations({ exclude: [] })).toEqual([]);
      expect(listTsconfigViolations({})).toEqual([]);
    });

    it('flags a vitest coverage exclude list', () => {
      expect(
        listVitestViolations({ test: { coverage: { exclude: ['a'] } } }),
      ).toEqual(['coverage.exclude']);
      expect(
        listVitestViolations({ test: { coverage: { exclude: [] } } }),
      ).toEqual([]);
      expect(listVitestViolations({ test: { coverage: {} } })).toEqual([]);
      expect(listVitestViolations({ test: {} })).toEqual([]);
      expect(listVitestViolations({})).toEqual([]);
    });

    it('flags negated mutate globs and unapproved sandbox ignores', () => {
      expect(
        listStrykerViolations({
          mutate: ['src/**/*.ts', '!src/skip.ts'],
          ignorePatterns: ['dist', 'src/legacy'],
        }),
      ).toEqual(['mutate:!src/skip.ts', 'ignorePatterns:src/legacy']);
    });

    it('checks each Stryker key independently', () => {
      expect(listStrykerViolations({ mutate: ['!a'] })).toEqual(['mutate:!a']);
      expect(listStrykerViolations({ ignorePatterns: ['b'] })).toEqual([
        'ignorePatterns:b',
      ]);
    });

    it('accepts a clean Stryker config and one without the keys', () => {
      expect(
        listStrykerViolations({
          mutate: ['src/**/*.ts'],
          ignorePatterns: ALLOWED_SANDBOX_IGNORES,
        }),
      ).toEqual([]);
      expect(listStrykerViolations({})).toEqual([]);
    });
  });

  describe('collectViolationCounts', () => {
    const texts = {
      'src/a.js': `${SAMPLES.lint}\n${SAMPLES.lint}`,
      'src/b.ts': SAMPLES['types-ignore'],
      'scripts/c.mjs': SAMPLES['coverage-v8'],
      'src/d.cjs': SAMPLES['coverage-c8'],
      'README.md': SAMPLES.lint,
      'src/data.json': SAMPLES.lint,
      '.eslintignore': 'dist\nsrc/popup-view/*\n',
      '.prettierignore': 'src/x/*\n',
      '.pre-commit-config.yaml': '            src/popup-view/.*|\n',
      'tsconfig.json': '{ "exclude": ["src/x"] }',
      'config/tsconfig.build.json': '{ "exclude": [] }',
      'tsconfig.txt': 'not json at all',
      'other-tsconfig.json': 'not json either',
    };
    const readText = vi.fn((file) => texts[file]);

    beforeEach(() => {
      readText.mockClear();
    });

    it('counts comments, ignore entries, hook excludes and tsconfig excludes', async () => {
      const counts = await collectViolationCounts({
        files: Object.keys(texts),
        readText,
        importConfig: vi.fn(),
      });

      expect(counts).toEqual({
        'comment|src/a.js|lint': 2,
        'comment|src/b.ts|types-ignore': 1,
        'comment|scripts/c.mjs|coverage-v8': 1,
        'comment|src/d.cjs|coverage-c8': 1,
        'ignore-entry|.eslintignore|src/popup-view/*': 1,
        'ignore-entry|.prettierignore|src/x/*': 1,
        'hook-exclude|.pre-commit-config.yaml|src/popup-view/.*': 1,
        'config|tsconfig.json|exclude': 1,
      });
    });

    it('does not read files that are not code or known config', async () => {
      await collectViolationCounts({
        files: [
          'README.md',
          'src/data.json',
          'tsconfig.txt',
          'other-tsconfig.json',
          'tsconfig.json.bak',
        ],
        readText,
        importConfig: vi.fn(),
      });

      expect(readText).not.toHaveBeenCalled();
    });

    it('only reads the hook config when it is in the file list', async () => {
      await collectViolationCounts({
        files: ['src/a.js'],
        readText,
        importConfig: vi.fn(),
      });

      expect(readText).toHaveBeenCalledTimes(1);
      expect(readText).toHaveBeenCalledWith('src/a.js');
    });

    it('inspects the vitest and stryker configs when present', async () => {
      const importConfig = vi.fn(async (file) =>
        file === 'vitest.config.mjs'
          ? { test: { coverage: { exclude: ['a'] } } }
          : { mutate: ['!x'], ignorePatterns: ['src/y'] },
      );

      const counts = await collectViolationCounts({
        files: ['vitest.config.mjs', 'stryker.config.mjs'],
        readText: () => 'export default {};',
        importConfig,
      });

      expect(importConfig).toHaveBeenCalledTimes(2);
      expect(counts).toEqual({
        'config|vitest.config.mjs|coverage.exclude': 1,
        'config|stryker.config.mjs|mutate:!x': 1,
        'config|stryker.config.mjs|ignorePatterns:src/y': 1,
      });
    });

    it('does not import configs that are missing', async () => {
      const importConfig = vi.fn();

      await collectViolationCounts({ files: [], readText, importConfig });

      expect(importConfig).not.toHaveBeenCalled();
    });
  });

  describe('compareWithAllowlist', () => {
    it('reports nothing when the counts match the allow-list exactly', () => {
      expect(compareWithAllowlist({ 'a|b': 2 }, { 'a|b': 2 })).toEqual([]);
      expect(compareWithAllowlist({}, {})).toEqual([]);
    });

    it('reports a suppression that is not allow-listed', () => {
      expect(compareWithAllowlist({ 'a|b': 1 }, {})).toEqual([
        'New suppression: a|b (found 1, allowed 0)',
      ]);
    });

    it('reports a suppression that exceeds its allowance', () => {
      expect(compareWithAllowlist({ 'a|b': 3 }, { 'a|b': 2 })).toEqual([
        'New suppression: a|b (found 3, allowed 2)',
      ]);
    });

    it('reports an allowance that is higher than what remains', () => {
      expect(compareWithAllowlist({ 'a|b': 1 }, { 'a|b': 2 })).toEqual([
        'Stale allowance, lower or remove it: a|b (allowed 2, found 1)',
      ]);
    });

    it('reports an allowance whose suppression is gone', () => {
      expect(compareWithAllowlist({}, { 'a|b': 1 })).toEqual([
        'Stale allowance, lower or remove it: a|b (allowed 1, found 0)',
      ]);
    });

    it('lists new suppressions before stale allowances', () => {
      expect(compareWithAllowlist({ 'x|y': 1 }, { 'a|b': 1 })).toEqual([
        'New suppression: x|y (found 1, allowed 0)',
        'Stale allowance, lower or remove it: a|b (allowed 1, found 0)',
      ]);
    });
  });

  describe('checkSuppressions', () => {
    it('returns the problems from comparing the repository with the allow-list', async () => {
      const problems = await checkSuppressions({
        files: ['src/a.js'],
        readText: () => SAMPLES.lint,
        importConfig: vi.fn(),
        allowlist: { 'comment|src/old.js|lint': 1 },
      });

      expect(problems).toEqual([
        'New suppression: comment|src/a.js|lint (found 1, allowed 0)',
        'Stale allowance, lower or remove it: comment|src/old.js|lint (allowed 1, found 0)',
      ]);
    });

    it('returns no problems for a clean repository', async () => {
      const problems = await checkSuppressions({
        files: ['src/a.js'],
        readText: () => 'const a = 1;',
        importConfig: vi.fn(),
        allowlist: {},
      });

      expect(problems).toEqual([]);
    });
  });
});
