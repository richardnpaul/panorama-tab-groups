import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../src/js/share/guards.js';

const manifest: unknown = JSON.parse(readFileSync('src/manifest.json', 'utf8'));
const readme = readFileSync('README.md', 'utf8');

/** The permissions the manifest asks for */
function permissions(): string[] {
  if (!isRecord(manifest) || !Array.isArray(manifest.permissions)) {
    throw new Error('the manifest has no permissions');
  }
  return manifest.permissions.filter(
    (permission): permission is string => typeof permission === 'string',
  );
}

describe('the permissions of the manifest', () => {
  it('are each explained in the README, which is where a person deciding whether to install looks', () => {
    const missing = permissions().filter(
      (permission) => !readme.includes(`| \`${permission}\``),
    );

    expect(missing).toEqual([]);
  });

  it('are the only ones the README explains', () => {
    const explained = [...readme.matchAll(/^\| `(\w+)`/gmu)].map(
      ([, permission]) => permission,
    );

    expect(explained.sort()).toEqual(permissions().sort());
  });

  it('include the notifications the add-on shows', () => {
    expect(permissions()).toContain('notifications');
  });
});
