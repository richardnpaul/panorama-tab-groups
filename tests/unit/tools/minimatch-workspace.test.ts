import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../../src/js/share/guards.js';

/** A property of a parsed manifest, when the manifest is an object at all */
const field = (value: unknown, key: string): unknown =>
  isRecord(value) ? value[key] : undefined;

// The sandbox of a mutation run has no node_modules of its own: it links the one of the repository
const repository = dirname(realpathSync('node_modules'));
const lock: unknown = JSON.parse(
  readFileSync(resolve(repository, 'package-lock.json'), 'utf8'),
);
const replacement = realpathSync(
  resolve(repository, 'tools/minimatch-compat/index.js'),
);

/** The folders of the packages that ask for minimatch, as the lock file has them */
const packages = field(lock, 'packages');
const askers = (isRecord(packages) ? Object.entries(packages) : [])
  .filter(
    ([folder, manifest]) =>
      folder !== '' &&
      !folder.startsWith('tools/') &&
      field(field(manifest, 'dependencies'), 'minimatch') !== undefined,
  )
  .map(([folder]) => folder);

describe('minimatch replacement', () => {
  it('is asked for by the packages that depend on minimatch', () => {
    // If none do, this file and tools/minimatch-compat can go (see CONTRIBUTION.md)
    expect(askers.length).toBeGreaterThan(0);
  });

  it.each(askers)(
    '%s gets the replacement, not a published minimatch',
    (folder) => {
      const from = createRequire(resolve(repository, folder, 'package.json'));

      expect(realpathSync(from.resolve('minimatch'))).toBe(replacement);
    },
  );

  it('is a private workspace package, applied to every dependent through the overrides of the repository', () => {
    const manifest: unknown = JSON.parse(
      readFileSync(resolve(repository, 'package.json'), 'utf8'),
    );

    expect(field(field(manifest, 'overrides'), 'minimatch')).toBe(
      'file:tools/minimatch-compat',
    );
    expect(
      field(
        JSON.parse(
          readFileSync(
            resolve(repository, 'tools/minimatch-compat/package.json'),
            'utf8',
          ),
        ),
        'private',
      ),
    ).toBe(true);
  });
});
