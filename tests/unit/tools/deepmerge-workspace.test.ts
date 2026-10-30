import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../../src/js/share/guards.js';

const require = createRequire(import.meta.url);

/** A property of a parsed manifest, when the manifest is an object at all */
const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const replacementManifest: unknown = JSON.parse(
  readFileSync('tools/deepmerge-patched/package.json', 'utf8'),
);
const linterManifest: unknown = JSON.parse(
  readFileSync('node_modules/addons-linter/package.json', 'utf8'),
);

describe('deepmerge replacement', () => {
  it('resolves to the in-repo package, not the published one', () => {
    // The package of the repository whose node_modules are in use, which is not
    // the working folder when a copy of the tests runs (as in Stryker's sandbox)
    const repository = dirname(realpathSync('node_modules'));

    expect(realpathSync(require.resolve('deepmerge'))).toBe(
      realpathSync(resolve(repository, 'tools/deepmerge-patched/index.js')),
    );
  });

  it('is a private workspace package named like the real one', () => {
    expect(field(replacementManifest, 'name')).toBe('deepmerge');
    expect(field(replacementManifest, 'private')).toBe(true);
  });

  it('has exactly the version addons-linter pins, so npm links the workspace', () => {
    expect(field(replacementManifest, 'version')).toBe(
      field(field(linterManifest, 'dependencies'), 'deepmerge'),
    );
  });
});
