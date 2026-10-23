import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../../src/js/share/guards.js';

const require = createRequire(import.meta.url);

/** A property of a parsed manifest, when the manifest is an object at all */
const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

const stubManifest: unknown = JSON.parse(
  readFileSync('tools/adbkit-stub/package.json', 'utf8'),
);
const webExtManifest: unknown = JSON.parse(
  readFileSync('node_modules/web-ext/package.json', 'utf8'),
);

describe('@devicefarmer/adbkit replacement', () => {
  it('resolves to the in-repo stub, not the published package', () => {
    // The stub of the repository whose node_modules are in use, which is not
    // the working folder when a copy of the tests runs (as in Stryker's sandbox)
    const repository = dirname(realpathSync('node_modules'));

    expect(realpathSync(require.resolve('@devicefarmer/adbkit'))).toBe(
      realpathSync(resolve(repository, 'tools/adbkit-stub/index.js')),
    );
  });

  it('is a private workspace package named like the real one', () => {
    expect(field(stubManifest, 'name')).toBe('@devicefarmer/adbkit');
    expect(field(stubManifest, 'private')).toBe(true);
  });

  it('has exactly the version web-ext pins, so npm links the workspace', () => {
    expect(field(stubManifest, 'version')).toBe(
      field(field(webExtManifest, 'dependencies'), '@devicefarmer/adbkit'),
    );
  });
});
