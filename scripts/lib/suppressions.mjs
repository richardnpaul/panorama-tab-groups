import { basename, extname } from 'node:path';

// The patterns are written so that this file never matches its own rules
export const COMMENT_SUPPRESSIONS = [
  { kind: 'coverage-istanbul', pattern: /istanbul\s+ignore/g },
  { kind: 'coverage-c8', pattern: /c8\s+ignore/g },
  { kind: 'coverage-v8', pattern: /v8\s+ignore/g },
  { kind: 'mutation', pattern: /stryker[\s-]+disable/gi },
  { kind: 'types-ignore', pattern: /@ts-[i]gnore/g },
  { kind: 'types-expect-error', pattern: /@ts-expect-[e]rror/g },
  { kind: 'types-nocheck', pattern: /@ts-no[c]heck/g },
  { kind: 'lint', pattern: /eslint-[d]isable/g },
];

export const CODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts'];

// Generated or tool output that is not source code
export const ALLOWED_IGNORE_ENTRIES = [
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
];

// Directories Stryker may skip when copying the project into its sandbox
export const ALLOWED_SANDBOX_IGNORES = [
  'test-user-data-*',
  'playwright-report',
  'test-results',
  'coverage',
  'dist',
  'reports',
];

export const IGNORE_FILES = ['.eslintignore', '.prettierignore'];
export const HOOK_CONFIG_FILE = '.pre-commit-config.yaml';
export const VITEST_CONFIG_FILE = 'vitest.config.mjs';
export const STRYKER_CONFIG_FILE = 'stryker.config.mjs';

export function countCommentSuppressions(text) {
  const counts = {};
  COMMENT_SUPPRESSIONS.forEach(({ kind, pattern }) => {
    const found = text.match(pattern);
    if (found) {
      counts[kind] = found.length;
    }
  });
  return counts;
}

export function listDisallowedIgnoreEntries(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .filter((line) => !ALLOWED_IGNORE_ENTRIES.includes(line));
}

export function listHookExcludes(text) {
  return [...text.matchAll(/^\s+((?:src|tests|scripts)\/\S+?)\|?\s*$/gm)].map(
    (match) => match[1],
  );
}

export function listTsconfigViolations(tsconfig) {
  return (tsconfig.exclude ?? []).length > 0 ? ['exclude'] : [];
}

export function listVitestViolations(config) {
  return (config.test?.coverage?.exclude ?? []).length > 0
    ? ['coverage.exclude']
    : [];
}

export function listStrykerViolations(config) {
  const negated =
    config.mutate
      ?.filter((glob) => glob.startsWith('!'))
      .map((glob) => `mutate:${glob}`) ?? [];
  const skipped =
    config.ignorePatterns
      ?.filter((pattern) => !ALLOWED_SANDBOX_IGNORES.includes(pattern))
      .map((pattern) => `ignorePatterns:${pattern}`) ?? [];
  return [...negated, ...skipped];
}

function addViolation(counts, key, amount = 1) {
  counts[key] = (counts[key] ?? 0) + amount;
}

export async function collectViolationCounts({
  files,
  readText,
  importConfig,
}) {
  const counts = {};

  files
    .filter((file) => CODE_EXTENSIONS.includes(extname(file)))
    .forEach((file) => {
      Object.entries(countCommentSuppressions(readText(file))).forEach(
        ([kind, amount]) => {
          addViolation(counts, `comment|${file}|${kind}`, amount);
        },
      );
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
      listTsconfigViolations(JSON.parse(readText(file))).forEach((what) => {
        addViolation(counts, `config|${file}|${what}`);
      });
    });

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

export function compareWithAllowlist(counts, allowlist) {
  const added = Object.entries(counts)
    .filter(([key, found]) => found > (allowlist[key] ?? 0))
    .map(
      ([key, found]) =>
        `New suppression: ${key} (found ${found}, allowed ${allowlist[key] ?? 0})`,
    );
  const stale = Object.entries(allowlist)
    .filter(([key, allowed]) => (counts[key] ?? 0) < allowed)
    .map(
      ([key, allowed]) =>
        `Stale allowance, lower or remove it: ${key} (allowed ${allowed}, found ${counts[key] ?? 0})`,
    );
  return [...added, ...stale];
}

export async function checkSuppressions({
  files,
  readText,
  importConfig,
  allowlist,
}) {
  const counts = await collectViolationCounts({
    files,
    readText,
    importConfig,
  });
  return compareWithAllowlist(counts, allowlist);
}
