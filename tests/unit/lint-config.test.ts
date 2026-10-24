import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isRecord } from '../../src/js/share/guards.js';

// What the linter must find in code written to break its rules, so a rule
// that is switched off, dropped in a migration or lost in an upgrade shows
// up here. The fixtures are text files, so the repository's own lint does not
// see them; they are linted in a project of their own, with the real
// configuration, plugin and TypeScript settings.

type Finding = [rule: string, line: number];

const REPO = resolve('.');
const fixture = (name: string): string =>
  readFileSync(join(REPO, 'tests/unit/lint-fixtures', name), 'utf8');

/** Where each fixture is placed in the project, which decides the rules that apply */
const PLACEMENTS: Record<string, { fixture: string; path: string }> = {
  source: { fixture: 'violations.txt', path: 'src/js/core/violations.ts' },
  adapter: {
    fixture: 'violations.txt',
    path: 'src/js/adapters/browser/violations.ts',
  },
  typed: { fixture: 'typed.txt', path: 'src/js/core/typed.ts' },
  generated: { fixture: 'violations.txt', path: 'dist/js/violations.ts' },
  hidden: { fixture: 'violations.txt', path: '.hidden/violations.ts' },
};

let project = '';
const findings = new Map<string, Finding[]>();

function place(path: string, text: string): void {
  mkdirSync(dirname(join(project, path)), { recursive: true });
  writeFileSync(join(project, path), text);
}

/** The diagnostics of one run of oxlint over the project, by file */
function lintProject(): Map<string, Finding[]> {
  let output = '';
  try {
    output = execFileSync(
      'node',
      [join(REPO, 'node_modules/oxlint/bin/oxlint'), '-f', 'json', '.'],
      { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error: unknown) {
    // Oxlint exits with 1 when it finds something, which is what is wanted
    output =
      isRecord(error) && typeof error.stdout === 'string' ? error.stdout : '';
  }
  const report: unknown = JSON.parse(output);
  const diagnostics: unknown[] =
    isRecord(report) && Array.isArray(report.diagnostics)
      ? report.diagnostics
      : [];
  const byFile = new Map<string, Finding[]>();
  diagnostics.forEach((diagnostic) => {
    if (!isRecord(diagnostic) || !Array.isArray(diagnostic.labels)) return;
    const label: unknown = diagnostic.labels[0];
    const span = isRecord(label) ? label.span : undefined;
    if (
      typeof diagnostic.filename !== 'string' ||
      typeof diagnostic.code !== 'string' ||
      !isRecord(span) ||
      typeof span.line !== 'number'
    ) {
      return;
    }
    const list = byFile.get(diagnostic.filename) ?? [];
    list.push([diagnostic.code, span.line]);
    byFile.set(diagnostic.filename, list);
  });
  byFile.forEach((list) => {
    list.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  });
  return byFile;
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'lint-config-'));
  [
    '.oxlintrc.json',
    'tsconfig.json',
    'tools/oxlint/boundary-plugin.ts',
  ].forEach((file) => {
    mkdirSync(dirname(join(project, file)), { recursive: true });
    cpSync(join(REPO, file), join(project, file));
  });
  cpSync(
    join(REPO, 'src/js/share/guards.ts'),
    join(project, 'src/js/share/guards.ts'),
  );
  symlinkSync(join(REPO, 'node_modules'), join(project, 'node_modules'));
  Object.values(PLACEMENTS).forEach(({ fixture: name, path }) => {
    place(path, fixture(name));
  });
  lintProject().forEach((list, file) => findings.set(file, list));
}, 120_000);

afterAll(() => {
  rmSync(project, { recursive: true, force: true });
});

const of = (name: string): Finding[] =>
  findings.get(PLACEMENTS[name]?.path ?? '') ?? [];

/** What the general rules find in the fixture of violations, wherever it is placed */
const GENERAL: Finding[] = [
  ['eslint(no-unused-vars)', 1],
  ['eslint(no-unused-vars)', 2],
  ['import(extensions)', 2],
  ['eslint(no-unused-vars)', 3],
  ['import(no-duplicates)', 3],
  ['eslint(no-unused-vars)', 4],
  ['eslint(no-unused-vars)', 5],
  ['typescript(no-explicit-any)', 7],
  ['typescript(no-non-null-assertion)', 9],
  ['eslint(no-var)', 14],
  ['eslint(vars-on-top)', 14],
  ['typescript(consistent-type-assertions)', 15],
  ['typescript(require-await)', 16],
  ['eslint(prefer-destructuring)', 18],
  ['typescript(consistent-type-assertions)', 18],
  ['eslint(eqeqeq)', 19],
  ['eslint(no-eval)', 21],
];

describe('the lint configuration', () => {
  it('finds what the general rules are there to find, in the source', () => {
    const boundary: Finding[] = [
      ['eslint(no-restricted-globals)', 7],
      ['panorama(no-browser-storage)', 7],
      ['panorama(no-browser-storage)', 18],
    ];

    expect(of('source')).toEqual(
      [...GENERAL, ...boundary].sort(
        (a, b) => a[1] - b[1] || a[0].localeCompare(b[0]),
      ),
    );
  });

  it('lets an adapter name the browser, and finds everything else', () => {
    expect(of('adapter')).toEqual(GENERAL);
  });

  it('finds what only the types can show', () => {
    expect(of('typed')).toEqual([
      ['typescript(no-explicit-any)', 2],
      ['typescript(no-floating-promises)', 7],
      ['typescript(await-thenable)', 10],
      ['typescript(no-misused-promises)', 14],
      ['typescript(no-misused-promises)', 18],
      ['typescript(no-unnecessary-condition)', 18],
      ['typescript(no-unsafe-assignment)', 23],
      ['typescript(no-unsafe-member-access)', 23],
      ['typescript(no-unsafe-assignment)', 24],
      ['typescript(no-unsafe-call)', 24],
      ['typescript(no-unsafe-assignment)', 25],
      ['typescript(no-unsafe-return)', 26],
      ['typescript(restrict-plus-operands)', 26],
      ['typescript(restrict-plus-operands)', 26],
      ['typescript(restrict-plus-operands)', 26],
      ['typescript(no-base-to-string)', 30],
      ['typescript(restrict-template-expressions)', 30],
      ['typescript(restrict-template-expressions)', 30],
      ['typescript(restrict-template-expressions)', 30],
      ['typescript(prefer-nullish-coalescing)', 32],
      ['eslint(prefer-destructuring)', 35],
      ['typescript(unbound-method)', 35],
      ['typescript(no-confusing-void-expression)', 39],
      ['typescript(consistent-type-assertions)', 43],
      ['typescript(no-unnecessary-condition)', 43],
      ['typescript(no-unnecessary-type-assertion)', 43],
      ['typescript(require-await)', 45],
      ['typescript(only-throw-error)', 49],
      ['typescript(no-base-to-string)', 52],
    ]);
  });

  it('does not look at generated code or at folders that start with a dot', () => {
    expect(of('generated')).toEqual([]);
    expect(of('hidden')).toEqual([]);
  });
});
