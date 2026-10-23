import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  checkSuppressions,
  defaultExportOf,
  parseAllowlist,
} from './lib/suppressions.js';

const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard'],
  { encoding: 'utf8' },
)
  .split('\n')
  .filter((file) => file !== '' && existsSync(file));

const problems = await checkSuppressions({
  files,
  readText: (file) => readFileSync(file, 'utf8'),
  importConfig: async (file) =>
    defaultExportOf(await import(pathToFileURL(resolve(file)).href)),
  allowlist: parseAllowlist(
    JSON.parse(readFileSync('scripts/suppression-allowlist.json', 'utf8')),
  ),
});

problems.forEach((problem) => {
  console.error(problem);
});
process.exitCode = problems.length === 0 ? 0 : 1;
