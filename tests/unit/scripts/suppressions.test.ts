import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_IGNORE_ENTRIES,
  ALLOWED_JAVASCRIPT_FILES,
  ALLOWED_KNIP_BINARIES,
  ALLOWED_KNIP_ENTRIES,
  ALLOWED_OXLINT_IGNORES,
  ALLOWED_SANDBOX_IGNORES,
  CODE_EXTENSIONS,
  FORBIDDEN_KNIP_KEYS,
  COMMENT_SUPPRESSIONS,
  HOOK_CONFIG_FILE,
  IGNORE_FILES,
  JAVASCRIPT_EXTENSIONS,
  KNIP_CONFIG_FILE,
  OXLINT_CONFIG_FILE,
  STRYKER_CONFIG_FILE,
  VITEST_CONFIG_FILE,
  type Repository,
  checkSuppressions,
  collectViolationCounts,
  compareWithAllowlist,
  countCommentSuppressions,
  defaultExportOf,
  listDisallowedIgnoreEntries,
  listHookExcludes,
  listJavaScriptFiles,
  listKnipViolations,
  listOxlintViolations,
  listStrykerViolations,
  listTsconfigViolations,
  listVitestViolations,
  parseAllowlist,
} from '../../../scripts/lib/suppressions.js';

// The trigger phrases are assembled at runtime so this file does not trip the guard
const phrase = (...words: string[]) => words.join(' ');

const noConfig = vi.fn<Repository['importConfig']>();
const SAMPLES = {
  'coverage-istanbul': phrase('/*', 'istanbul', 'ignore', 'next */'),
  'coverage-c8': phrase('/*', 'c8', 'ignore', 'next */'),
  'coverage-v8': phrase('/*', 'v8', 'ignore', 'next */'),
  mutation: phrase('//', 'Stryker', 'disable', 'next-line'),
  'types-ignore': phrase('//', ['@ts', 'ignore'].join('-')),
  'types-expect-error': phrase('//', ['@ts', 'expect', 'error'].join('-')),
  'types-nocheck': phrase('//', ['@ts', 'nocheck'].join('-')),
  'knip-tag': phrase('/**', ['@', 'public'].join(''), '*/'),
  lint: phrase('//', ['eslint', 'disable', 'next', 'line'].join('-'), 'rule'),
};

describe('scripts/lib/suppressions.js', () => {
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
        'knip-tag',
      ]);
    });

    it('scans only code files', () => {
      expect(CODE_EXTENSIONS).toEqual(['.js', '.mjs', '.cjs', '.ts']);
    });

    it('allows only generated or tool output in ignore files', () => {
      expect(ALLOWED_IGNORE_ENTRIES).toEqual([
        'build',
        'dist',
        'dist-firefox',
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
        'dist-firefox',
        'reports',
      ]);
    });

    it('names the config files it inspects', () => {
      expect(IGNORE_FILES).toEqual(['.prettierignore']);
      expect(HOOK_CONFIG_FILE).toBe('.pre-commit-config.yaml');
      expect(VITEST_CONFIG_FILE).toBe('vitest.config.ts');
      expect(STRYKER_CONFIG_FILE).toBe('stryker.config.mjs');
      expect(OXLINT_CONFIG_FILE).toBe('.oxlintrc.json');
      expect(KNIP_CONFIG_FILE).toBe('knip.json');
    });
  });

  describe('countCommentSuppressions', () => {
    it.each(Object.entries(SAMPLES))('detects %s', (kind, sample) => {
      expect(countCommentSuppressions(`const a = 1; ${sample}\n`)).toEqual({
        [kind]: 1,
      });
    });

    it.each([
      ['oxlint', phrase('//', ['oxlint', 'disable', 'next', 'line'].join('-'))],
      ['eslint', phrase('//', ['eslint', 'disable', 'next', 'line'].join('-'))],
    ])('detects a %s directive as a lint suppression', (_name, sample) => {
      expect(countCommentSuppressions(sample)).toEqual({ lint: 1 });
    });

    it.each(['public', 'internal', 'lintignore'])(
      'detects the knip tag @%s',
      (tag) => {
        expect(
          countCommentSuppressions(phrase('/**', ['@', tag].join(''), '*/')),
        ).toEqual({ 'knip-tag': 1 });
      },
    );

    it.each(['publication', 'internally', 'lintignored', 'public', ''])(
      'does not take @%s followed by more letters, or a bare word, for a knip tag',
      (word) => {
        const text = word === 'public' ? 'a public API' : `@${word}`;

        expect(countCommentSuppressions(text)).toEqual({});
      },
    );

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

  describe('listJavaScriptFiles', () => {
    it('allows only the files that tools load as JavaScript', () => {
      expect(ALLOWED_JAVASCRIPT_FILES).toEqual([
        'stryker.config.mjs',
        'tools/adbkit-stub/index.js',
        'tools/deepmerge-patched/index.js',
        'tools/minimatch-compat/index.js',
      ]);
      expect(JAVASCRIPT_EXTENSIONS).toEqual(['.js', '.mjs', '.cjs']);
    });

    it.each([
      'src/js/new.js',
      'scripts/tool.mjs',
      'tests/e2e/old.spec.js',
      'config.cjs',
      'tools/adbkit-stub/other.js',
      '.eslintrc.cjs',
      'tools/oxlint/plugin.js',
      'nested/stryker.config.mjs',
    ])('reports %s', (file) => {
      expect(listJavaScriptFiles([file])).toEqual([file]);
    });

    it.each([
      ...ALLOWED_JAVASCRIPT_FILES,
      'src/js/a.ts',
      'tools/adbkit-stub/index.d.ts',
      'src/data.json',
      'README.md',
      'src/js',
      'notes.js.txt',
    ])('accepts %s', (file) => {
      expect(listJavaScriptFiles([file])).toEqual([]);
    });

    it('keeps the order of the files it reports', () => {
      expect(
        listJavaScriptFiles(['b.js', 'stryker.config.mjs', 'a.mjs', 'c.ts']),
      ).toEqual(['b.js', 'a.mjs']);
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

    const FULL_THRESHOLDS = {
      statements: 100,
      branches: 100,
      functions: 100,
      lines: 100,
    };
    const CLEAN_STRYKER = {
      mutate: ['src/**/*.ts'],
      ignorePatterns: ALLOWED_SANDBOX_IGNORES,
      thresholds: { high: 100, low: 100, break: 100 },
      checkers: ['typescript'],
      coverageAnalysis: 'perTest',
    };

    it('flags a vitest coverage exclude list', () => {
      expect(
        listVitestViolations({
          test: {
            coverage: { exclude: ['a'], thresholds: FULL_THRESHOLDS },
          },
        }),
      ).toEqual(['coverage.exclude']);
      expect(
        listVitestViolations({
          test: { coverage: { exclude: [], thresholds: FULL_THRESHOLDS } },
        }),
      ).toEqual([]);
      expect(
        listVitestViolations({
          test: { coverage: { thresholds: FULL_THRESHOLDS } },
        }),
      ).toEqual([]);
    });

    it('flags each coverage threshold that is not 100, or is missing', () => {
      ['statements', 'branches', 'functions', 'lines'].forEach((metric) => {
        expect(
          listVitestViolations({
            test: {
              coverage: { thresholds: { ...FULL_THRESHOLDS, [metric]: 99 } },
            },
          }),
        ).toEqual([`coverage.thresholds.${metric}`]);
      });
      expect(
        listVitestViolations({
          test: {
            coverage: { thresholds: { ...FULL_THRESHOLDS, lines: 100.5 } },
          },
        }),
      ).toEqual(['coverage.thresholds.lines']);
      expect(listVitestViolations({ test: { coverage: {} } })).toEqual([
        'coverage.thresholds.statements',
        'coverage.thresholds.branches',
        'coverage.thresholds.functions',
        'coverage.thresholds.lines',
      ]);
      expect(listVitestViolations({ test: {} })).toHaveLength(4);
      expect(listVitestViolations({})).toHaveLength(4);
    });

    it('lists an exclude list before the thresholds', () => {
      expect(
        listVitestViolations({
          test: { coverage: { exclude: ['a'], thresholds: { lines: 100 } } },
        }),
      ).toEqual([
        'coverage.exclude',
        'coverage.thresholds.statements',
        'coverage.thresholds.branches',
        'coverage.thresholds.functions',
      ]);
    });

    it('flags negated mutate globs and unapproved sandbox ignores', () => {
      expect(
        listStrykerViolations({
          ...CLEAN_STRYKER,
          mutate: ['src/**/*.ts', '!src/skip.ts'],
          ignorePatterns: ['dist', 'src/legacy'],
        }),
      ).toEqual(['mutate:!src/skip.ts', 'ignorePatterns:src/legacy']);
    });

    it('ignores entries of a Stryker list that are not text', () => {
      expect(
        listStrykerViolations({
          ...CLEAN_STRYKER,
          mutate: ['src/**/*.ts', 3, '!x'],
          ignorePatterns: [null, 'y'],
          checkers: [{ name: 'typescript' }],
        }),
      ).toEqual(['mutate:!x', 'ignorePatterns:y', 'checkers.typescript']);
    });

    it('treats a config that is not an object as one without any key', () => {
      expect(listTsconfigViolations(null)).toEqual([]);
      expect(listVitestViolations('text')).toHaveLength(4);
      expect(listStrykerViolations(undefined)).toEqual([
        'thresholds.high',
        'thresholds.low',
        'thresholds.break',
        'checkers.typescript',
        'coverageAnalysis',
      ]);
    });

    it('checks each Stryker key independently', () => {
      expect(
        listStrykerViolations({ ...CLEAN_STRYKER, mutate: ['!a'] }),
      ).toEqual(['mutate:!a']);
      expect(
        listStrykerViolations({ ...CLEAN_STRYKER, ignorePatterns: ['b'] }),
      ).toEqual(['ignorePatterns:b']);
    });

    it('flags each mutation threshold that is not 100, or is missing', () => {
      ['high', 'low', 'break'].forEach((level) => {
        expect(
          listStrykerViolations({
            ...CLEAN_STRYKER,
            thresholds: { high: 100, low: 100, break: 100, [level]: 99 },
          }),
        ).toEqual([`thresholds.${level}`]);
      });
      expect(
        listStrykerViolations({ ...CLEAN_STRYKER, thresholds: null }),
      ).toEqual(['thresholds.high', 'thresholds.low', 'thresholds.break']);
    });

    it('flags a Stryker run without the type checker or per-test analysis', () => {
      expect(listStrykerViolations({ ...CLEAN_STRYKER, checkers: [] })).toEqual(
        ['checkers.typescript'],
      );
      expect(
        listStrykerViolations({ ...CLEAN_STRYKER, checkers: ['other'] }),
      ).toEqual(['checkers.typescript']);
      expect(
        listStrykerViolations({ ...CLEAN_STRYKER, checkers: undefined }),
      ).toEqual(['checkers.typescript']);
      expect(
        listStrykerViolations({ ...CLEAN_STRYKER, coverageAnalysis: 'all' }),
      ).toEqual(['coverageAnalysis']);
      expect(
        listStrykerViolations({
          ...CLEAN_STRYKER,
          coverageAnalysis: undefined,
        }),
      ).toEqual(['coverageAnalysis']);
    });

    it('allows oxlint to skip only generated output and folders that start with a dot', () => {
      expect(ALLOWED_OXLINT_IGNORES).toEqual([
        '**/.*',
        '**/.*/**',
        'build/**',
        'dist/**',
        'dist-firefox/**',
        'node_modules/**',
        'test-user-data*/**',
        'playwright-report/**',
        'coverage/**',
        'test-results/**',
        'reports/**',
        'web-ext-artifacts/**',
      ]);
    });

    it('allows knip only what cannot be an npm package, and files loaded by path', () => {
      expect(ALLOWED_KNIP_BINARIES).toEqual(['act', 'pre-commit', 'pkill']);
      expect(ALLOWED_KNIP_ENTRIES).toEqual([
        'tests/unit/scripts/fixtures/*.ts',
        'tests/e2e/lab/probe.ts',
      ]);
      expect(FORBIDDEN_KNIP_KEYS).toEqual([
        'ignore',
        'ignoreFiles',
        'ignoreExportsUsedInFile',
        'ignoreMembers',
        'ignoreDependencies',
        'ignoreUnresolved',
        'ignoreIssues',
        'ignoreWorkspaces',
        'exclude',
        'include',
        'rules',
        'project',
        'paths',
      ]);
    });

    it('accepts a clean knip config, with or without workspaces', () => {
      const clean = {
        ignoreBinaries: ALLOWED_KNIP_BINARIES,
      };

      expect(listKnipViolations(clean)).toEqual([]);
      expect(
        listKnipViolations({
          ...clean,
          workspaces: {
            '.': { entry: ALLOWED_KNIP_ENTRIES },
            'tools/adbkit-stub': {},
          },
        }),
      ).toEqual([]);
      expect(listKnipViolations({})).toEqual([]);
      expect(listKnipViolations(null)).toEqual([]);
    });

    it.each(FORBIDDEN_KNIP_KEYS)('flags knip being given %s', (key) => {
      expect(listKnipViolations({ [key]: [] })).toEqual([key]);
      expect(
        listKnipViolations({ workspaces: { tools: { [key]: ['x'] } } }),
      ).toEqual([`workspaces.tools.${key}`]);
    });

    it.each([
      ['ignoreBinaries', 'tsx'],
      ['entry', 'src/**/*.ts'],
    ])('flags %s that names something not allowed (%s)', (key, entry) => {
      expect(listKnipViolations({ [key]: [entry] })).toEqual([
        `${key}:${entry}`,
      ]);
      expect(
        listKnipViolations({ workspaces: { tools: { [key]: [entry] } } }),
      ).toEqual([`workspaces.tools.${key}:${entry}`]);
    });

    it('ignores entries that are not text, and a workspaces key that is not an object', () => {
      expect(listKnipViolations({ ignoreBinaries: [3, null, 'act'] })).toEqual(
        [],
      );
      expect(listKnipViolations({ workspaces: 'all' })).toEqual([]);
    });

    it('lists the top level before the workspaces, forbidden keys before names', () => {
      expect(
        listKnipViolations({
          ignoreBinaries: ['x'],
          rules: {},
          workspaces: { a: { ignore: ['y'] } },
        }),
      ).toEqual(['rules', 'ignoreBinaries:x', 'workspaces.a.ignore']);
    });

    it('accepts a clean oxlint config', () => {
      expect(
        listOxlintViolations({
          ignorePatterns: ALLOWED_OXLINT_IGNORES,
          options: { typeAware: true },
        }),
      ).toEqual([]);
    });

    it.each([
      ['a source folder', 'src/legacy/**'],
      ['a test folder', 'tests/**'],
      ['everything', '**'],
      ['a pattern that only looks like an allowed one', 'dist'],
    ])('flags oxlint skipping %s', (_name, pattern) => {
      expect(
        listOxlintViolations({
          ignorePatterns: [...ALLOWED_OXLINT_IGNORES, pattern],
          options: { typeAware: true },
        }),
      ).toEqual([`ignorePatterns:${pattern}`]);
    });

    it.each([
      ['switched off', { typeAware: false }],
      ['missing', {}],
      ['not a boolean', { typeAware: 'yes' }],
    ])('flags the type-aware rules being %s', (_name, options) => {
      expect(listOxlintViolations({ ignorePatterns: [], options })).toEqual([
        'options.typeAware',
      ]);
    });

    it('flags an oxlint config without the keys, and ignores entries that are not text', () => {
      expect(listOxlintViolations({})).toEqual(['options.typeAware']);
      expect(listOxlintViolations(null)).toEqual(['options.typeAware']);
      expect(
        listOxlintViolations({
          ignorePatterns: [3, null, 'src/x/**'],
          options: { typeAware: true },
        }),
      ).toEqual(['ignorePatterns:src/x/**']);
    });

    it('accepts a clean Stryker config, and flags one without the keys', () => {
      expect(listStrykerViolations(CLEAN_STRYKER)).toEqual([]);
      expect(listStrykerViolations({})).toEqual([
        'thresholds.high',
        'thresholds.low',
        'thresholds.break',
        'checkers.typescript',
        'coverageAnalysis',
      ]);
    });
  });

  describe('collectViolationCounts', () => {
    const texts: Record<string, string> = {
      'src/a.js': `${SAMPLES.lint}\n${SAMPLES.lint}`,
      'src/b.ts': SAMPLES['types-ignore'],
      'scripts/c.mjs': SAMPLES['coverage-v8'],
      'src/d.cjs': SAMPLES['coverage-c8'],
      'README.md': SAMPLES.lint,
      'src/data.json': SAMPLES.lint,
      '.prettierignore': 'src/x/*\n',
      '.pre-commit-config.yaml': '            src/popup-view/.*|\n',
      'tsconfig.json': '{ "exclude": ["src/x"] }',
      'config/tsconfig.build.json': '{ "exclude": [] }',
      'tsconfig.txt': 'not json at all',
      'other-tsconfig.json': 'not json either',
    };
    const readText = vi.fn((file: string): string => texts[file] ?? '');

    beforeEach(() => {
      readText.mockClear();
    });

    it('counts a JavaScript file that should be TypeScript, without reading it', async () => {
      const counts = await collectViolationCounts({
        files: ['src/js/new.js', 'tools/adbkit-stub/index.js', 'src/b.ts'],
        readText: () => '',
        importConfig: noConfig,
      });

      expect(counts).toEqual({ 'javascript|src/js/new.js': 1 });
    });

    it('counts comments, ignore entries, hook excludes and tsconfig excludes', async () => {
      const counts = await collectViolationCounts({
        files: Object.keys(texts),
        readText,
        importConfig: noConfig,
      });

      expect(counts).toEqual({
        'javascript|src/a.js': 1,
        'javascript|scripts/c.mjs': 1,
        'javascript|src/d.cjs': 1,
        'comment|src/a.js|lint': 2,
        'comment|src/b.ts|types-ignore': 1,
        'comment|scripts/c.mjs|coverage-v8': 1,
        'comment|src/d.cjs|coverage-c8': 1,
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
        importConfig: noConfig,
      });

      expect(readText).not.toHaveBeenCalled();
    });

    it('only reads the hook config when it is in the file list', async () => {
      await collectViolationCounts({
        files: ['src/a.js'],
        readText,
        importConfig: noConfig,
      });

      expect(readText).toHaveBeenCalledTimes(1);
      expect(readText).toHaveBeenCalledWith('src/a.js');
    });

    it('inspects the vitest and stryker configs when present', async () => {
      const importConfig = vi.fn((file: string) =>
        Promise.resolve(
          file === 'vitest.config.ts'
            ? {
                test: {
                  coverage: {
                    exclude: ['a'],
                    thresholds: {
                      statements: 100,
                      branches: 100,
                      functions: 100,
                      lines: 90,
                    },
                  },
                },
              }
            : {
                mutate: ['!x'],
                ignorePatterns: ['src/y'],
                thresholds: { high: 100, low: 100, break: 80 },
                checkers: ['typescript'],
                coverageAnalysis: 'all',
              },
        ),
      );

      const counts = await collectViolationCounts({
        files: ['vitest.config.ts', 'stryker.config.mjs'],
        readText: () => 'export default {};',
        importConfig,
      });

      expect(importConfig).toHaveBeenCalledTimes(2);
      expect(counts).toEqual({
        'config|vitest.config.ts|coverage.exclude': 1,
        'config|vitest.config.ts|coverage.thresholds.lines': 1,
        'config|stryker.config.mjs|mutate:!x': 1,
        'config|stryker.config.mjs|ignorePatterns:src/y': 1,
        'config|stryker.config.mjs|thresholds.break': 1,
        'config|stryker.config.mjs|coverageAnalysis': 1,
      });
    });

    it('inspects the oxlint config when present, as JSON that is not imported', async () => {
      const importConfig = vi.fn<Repository['importConfig']>();

      const counts = await collectViolationCounts({
        files: [OXLINT_CONFIG_FILE],
        readText: () =>
          JSON.stringify({
            ignorePatterns: ['src/legacy/**'],
            options: { typeAware: false },
          }),
        importConfig,
      });

      expect(counts).toEqual({
        'config|.oxlintrc.json|ignorePatterns:src/legacy/**': 1,
        'config|.oxlintrc.json|options.typeAware': 1,
      });
      expect(importConfig).not.toHaveBeenCalled();
    });

    it('inspects the knip config when present, as JSON that is not imported', async () => {
      const importConfig = vi.fn<Repository['importConfig']>();

      const counts = await collectViolationCounts({
        files: [KNIP_CONFIG_FILE],
        readText: () =>
          JSON.stringify({ ignore: ['src/**'], ignoreBinaries: ['tsx'] }),
        importConfig,
      });

      expect(counts).toEqual({
        'config|knip.json|ignore': 1,
        'config|knip.json|ignoreBinaries:tsx': 1,
      });
      expect(importConfig).not.toHaveBeenCalled();
    });

    it('does not import configs that are missing', async () => {
      const importConfig = vi.fn<Repository['importConfig']>();

      await collectViolationCounts({ files: [], readText, importConfig });

      expect(importConfig).not.toHaveBeenCalled();
    });
  });

  describe('defaultExportOf', () => {
    it('returns the default export of a loaded module', () => {
      expect(defaultExportOf({ default: { a: 1 }, other: 2 })).toEqual({
        a: 1,
      });
    });

    it('returns nothing for a module without one', () => {
      expect(defaultExportOf({ other: 2 })).toBeUndefined();
      expect(defaultExportOf(null)).toBeUndefined();
    });
  });

  describe('parseAllowlist', () => {
    it('keeps every allowance that is a count', () => {
      expect(parseAllowlist({ 'a|b': 1, 'c|d': 0 })).toEqual({
        'a|b': 1,
        'c|d': 0,
      });
    });

    it('drops an allowance that is not a number', () => {
      expect(parseAllowlist({ 'a|b': '2', 'c|d': 3 })).toEqual({ 'c|d': 3 });
    });

    it('allows nothing when the file is not an object', () => {
      expect(parseAllowlist(null)).toEqual({});
      expect(parseAllowlist('a|b')).toEqual({});
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
        files: ['src/a.ts'],
        readText: () => SAMPLES.lint,
        importConfig: noConfig,
        allowlist: { 'comment|src/old.js|lint': 1 },
      });

      expect(problems).toEqual([
        'New suppression: comment|src/a.ts|lint (found 1, allowed 0)',
        'Stale allowance, lower or remove it: comment|src/old.js|lint (allowed 1, found 0)',
      ]);
    });

    it('returns no problems for a clean repository', async () => {
      const problems = await checkSuppressions({
        files: ['src/a.ts'],
        readText: () => 'const a = 1;',
        importConfig: noConfig,
        allowlist: {},
      });

      expect(problems).toEqual([]);
    });
  });
});
