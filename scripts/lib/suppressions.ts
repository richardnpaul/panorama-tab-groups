import { basename, extname } from 'node:path';
import { isNumber, isRecord, isString } from '../../src/js/share/guards.js';

export type Counts = Record<string, number>;

export interface Repository {
  files: string[];
  readText: (file: string) => string;
  /** The default export of a configuration module, whatever its shape */
  importConfig: (file: string) => Promise<unknown>;
}

// The patterns are written so that this file never matches its own rules
export const COMMENT_SUPPRESSIONS = [
  { kind: 'coverage-istanbul', pattern: /istanbul\s+ignore/g },
  { kind: 'coverage-c8', pattern: /c8\s+ignore/g },
  { kind: 'coverage-v8', pattern: /v8\s+ignore/g },
  { kind: 'mutation', pattern: /stryker[\s-]+disable/gi },
  { kind: 'types-ignore', pattern: /@ts-[i]gnore/g },
  { kind: 'types-expect-error', pattern: /@ts-expect-[e]rror/g },
  { kind: 'types-nocheck', pattern: /@ts-no[c]heck/g },
  { kind: 'lint', pattern: /(?:es|ox)lint-[d]isable/g },
  // Tags that tell knip an export is meant to be unused
  { kind: 'knip-tag', pattern: /@(?:pu[b]lic|inte[r]nal|lint[i]gnore)\b/g },
];

export const CODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts'];

// Generated or tool output that is not source code
export const ALLOWED_IGNORE_ENTRIES = [
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
];

// Directories Stryker may skip when copying the project into its sandbox
export const ALLOWED_SANDBOX_IGNORES = [
  'test-user-data-*',
  'playwright-report',
  'test-results',
  'coverage',
  'dist',
  'dist-firefox',
  'reports',
];

// Read by tools that load only JavaScript; everything else is TypeScript
export const ALLOWED_JAVASCRIPT_FILES = [
  'stryker.config.mjs',
  'tools/adbkit-stub/index.js',
];
export const JAVASCRIPT_EXTENSIONS = ['.js', '.mjs', '.cjs'];

export const IGNORE_FILES = ['.prettierignore'];
export const HOOK_CONFIG_FILE = '.pre-commit-config.yaml';
export const VITEST_CONFIG_FILE = 'vitest.config.ts';
export const STRYKER_CONFIG_FILE = 'stryker.config.mjs';
export const OXLINT_CONFIG_FILE = '.oxlintrc.json';
export const KNIP_CONFIG_FILE = 'knip.json';

// What knip may be told to leave alone, and nothing else: system tools that are
// not npm packages, and files that tests load by a path written as text
export const ALLOWED_KNIP_BINARIES = ['act', 'pre-commit', 'pkill'];
export const ALLOWED_KNIP_ENTRIES = ['tests/unit/scripts/fixtures/*.ts'];
// Any of these, in any form, hides code from knip or narrows what it looks at
export const FORBIDDEN_KNIP_KEYS = [
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
];

// What oxlint may skip: generated output and folders that start with a dot
export const ALLOWED_OXLINT_IGNORES = [
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
];

/** A property of something parsed from a file, when it is an object at all */
const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const isNonEmptyList = (value: unknown): boolean =>
  Array.isArray(value) && value.length > 0;

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter(isString) : [];

export function countCommentSuppressions(text: string): Counts {
  const counts: Counts = {};
  COMMENT_SUPPRESSIONS.forEach(({ kind, pattern }) => {
    const found = text.match(pattern);
    if (found) {
      counts[kind] = found.length;
    }
  });
  return counts;
}

export function listDisallowedIgnoreEntries(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => !ALLOWED_IGNORE_ENTRIES.includes(line));
}

export function listHookExcludes(text: string): string[] {
  // Each match contributes its one captured path
  return [
    ...text.matchAll(/^\s+((?:src|tests|scripts)\/\S+?)\|?\s*$/gm),
  ].flatMap((match) => match.slice(1, 2));
}

/** The JavaScript files that should be TypeScript */
export function listJavaScriptFiles(files: readonly string[]): string[] {
  return files.filter(
    (file) =>
      JAVASCRIPT_EXTENSIONS.includes(extname(file)) &&
      !ALLOWED_JAVASCRIPT_FILES.includes(file),
  );
}

export function listTsconfigViolations(tsconfig: unknown): string[] {
  return isNonEmptyList(field(tsconfig, 'exclude')) ? ['exclude'] : [];
}

// What the gates of the test runners must stay at; lowering one is a way of skipping what fails it
const COVERAGE_METRICS = ['statements', 'branches', 'functions', 'lines'];
const MUTATION_THRESHOLDS = ['high', 'low', 'break'];

export function listVitestViolations(config: unknown): string[] {
  const coverage = field(field(config, 'test'), 'coverage');
  const excluded = isNonEmptyList(field(coverage, 'exclude'))
    ? ['coverage.exclude']
    : [];
  const thresholds = field(coverage, 'thresholds');
  const lowered = COVERAGE_METRICS.filter(
    (metric) => field(thresholds, metric) !== 100,
  ).map((metric) => `coverage.thresholds.${metric}`);
  return [...excluded, ...lowered];
}

export function listOxlintViolations(config: unknown): string[] {
  const skipped = stringsOf(field(config, 'ignorePatterns'))
    .filter((pattern) => !ALLOWED_OXLINT_IGNORES.includes(pattern))
    .map((pattern) => `ignorePatterns:${pattern}`);
  const untyped =
    field(field(config, 'options'), 'typeAware') === true
      ? []
      : ['options.typeAware'];
  return [...skipped, ...untyped];
}

const KNIP_LISTS: [key: string, allowed: string[]][] = [
  ['ignoreBinaries', ALLOWED_KNIP_BINARIES],
  ['entry', ALLOWED_KNIP_ENTRIES],
];

/** The ways one level of the knip config (the top, or one workspace) hides code */
function listKnipLevelViolations(level: unknown, prefix: string): string[] {
  const forbidden = FORBIDDEN_KNIP_KEYS.filter(
    (key) => field(level, key) !== undefined,
  ).map((key) => `${prefix}${key}`);
  const listed = KNIP_LISTS.flatMap(([key, allowed]) =>
    stringsOf(field(level, key))
      .filter((entry) => !allowed.includes(entry))
      .map((entry) => `${prefix}${key}:${entry}`),
  );
  return [...forbidden, ...listed];
}

export function listKnipViolations(config: unknown): string[] {
  const workspaces = field(config, 'workspaces');
  const nested = isRecord(workspaces)
    ? Object.entries(workspaces).flatMap(([name, workspace]) =>
        listKnipLevelViolations(workspace, `workspaces.${name}.`),
      )
    : [];
  return [...listKnipLevelViolations(config, ''), ...nested];
}

export function listStrykerViolations(config: unknown): string[] {
  const negated = stringsOf(field(config, 'mutate'))
    .filter((glob) => glob.startsWith('!'))
    .map((glob) => `mutate:${glob}`);
  const skipped = stringsOf(field(config, 'ignorePatterns'))
    .filter((pattern) => !ALLOWED_SANDBOX_IGNORES.includes(pattern))
    .map((pattern) => `ignorePatterns:${pattern}`);
  const thresholds = field(config, 'thresholds');
  const lowered = MUTATION_THRESHOLDS.filter(
    (level) => field(thresholds, level) !== 100,
  ).map((level) => `thresholds.${level}`);
  const unchecked = stringsOf(field(config, 'checkers')).includes('typescript')
    ? []
    : ['checkers.typescript'];
  const analysis =
    field(config, 'coverageAnalysis') === 'perTest' ? [] : ['coverageAnalysis'];
  return [...negated, ...skipped, ...lowered, ...unchecked, ...analysis];
}

function addViolation(counts: Counts, key: string, amount = 1): void {
  counts[key] = (counts[key] ?? 0) + amount;
}

export async function collectViolationCounts({
  files,
  readText,
  importConfig,
}: Repository): Promise<Counts> {
  const counts: Counts = {};

  files
    .filter((file) => CODE_EXTENSIONS.includes(extname(file)))
    .forEach((file) => {
      Object.entries(countCommentSuppressions(readText(file))).forEach(
        ([kind, amount]) => {
          addViolation(counts, `comment|${file}|${kind}`, amount);
        },
      );
    });

  listJavaScriptFiles(files).forEach((file) => {
    addViolation(counts, `javascript|${file}`);
  });

  files
    .filter((file) => IGNORE_FILES.includes(file))
    .forEach((file) => {
      listDisallowedIgnoreEntries(readText(file)).forEach((entry) => {
        addViolation(counts, `ignore-entry|${file}|${entry}`);
      });
    });

  if (files.includes(HOOK_CONFIG_FILE)) {
    listHookExcludes(readText(HOOK_CONFIG_FILE)).forEach((entry) => {
      addViolation(counts, `hook-exclude|${HOOK_CONFIG_FILE}|${entry}`);
    });
  }

  files
    .filter((file) => /^tsconfig.*\.json$/.test(basename(file)))
    .forEach((file) => {
      const tsconfig: unknown = JSON.parse(readText(file));
      listTsconfigViolations(tsconfig).forEach((what) => {
        addViolation(counts, `config|${file}|${what}`);
      });
    });

  if (files.includes(KNIP_CONFIG_FILE)) {
    const knip: unknown = JSON.parse(readText(KNIP_CONFIG_FILE));
    listKnipViolations(knip).forEach((what) => {
      addViolation(counts, `config|${KNIP_CONFIG_FILE}|${what}`);
    });
  }

  if (files.includes(OXLINT_CONFIG_FILE)) {
    const oxlint: unknown = JSON.parse(readText(OXLINT_CONFIG_FILE));
    listOxlintViolations(oxlint).forEach((what) => {
      addViolation(counts, `config|${OXLINT_CONFIG_FILE}|${what}`);
    });
  }

  if (files.includes(VITEST_CONFIG_FILE)) {
    listVitestViolations(await importConfig(VITEST_CONFIG_FILE)).forEach(
      (what) => {
        addViolation(counts, `config|${VITEST_CONFIG_FILE}|${what}`);
      },
    );
  }

  if (files.includes(STRYKER_CONFIG_FILE)) {
    listStrykerViolations(await importConfig(STRYKER_CONFIG_FILE)).forEach(
      (what) => {
        addViolation(counts, `config|${STRYKER_CONFIG_FILE}|${what}`);
      },
    );
  }

  return counts;
}

/** What a configuration module exports as its default */
export const defaultExportOf = (loaded: unknown): unknown =>
  field(loaded, 'default');

/** The allow-list as read from its file: only numbers are allowances */
export function parseAllowlist(value: unknown): Counts {
  return isRecord(value)
    ? Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, number] =>
          isNumber(entry[1]),
        ),
      )
    : {};
}

export function compareWithAllowlist(
  counts: Counts,
  allowlist: Counts,
): string[] {
  const added = Object.entries(counts)
    .filter(([key, found]) => found > (allowlist[key] ?? 0))
    .map(
      ([key, found]) =>
        `New suppression: ${key} (found ${String(found)}, allowed ${String(allowlist[key] ?? 0)})`,
    );
  const stale = Object.entries(allowlist)
    .filter(([key, allowed]) => (counts[key] ?? 0) < allowed)
    .map(
      ([key, allowed]) =>
        `Stale allowance, lower or remove it: ${key} (allowed ${String(allowed)}, found ${String(counts[key] ?? 0)})`,
    );
  return [...added, ...stale];
}

export async function checkSuppressions({
  files,
  readText,
  importConfig,
  allowlist,
}: Repository & { allowlist: Counts }): Promise<string[]> {
  const counts = await collectViolationCounts({
    files,
    readText,
    importConfig,
  });
  return compareWithAllowlist(counts, allowlist);
}
