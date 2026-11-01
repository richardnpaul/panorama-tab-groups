import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { isRecord } from '../../src/js/share/guards.js';
import {
  GLOBSTAR,
  Minimatch,
  braceExpand,
  defaults,
  escape,
  filter,
  match,
  minimatch,
  sep,
  unescape,
} from './index.js';

const require = createRequire(import.meta.url);

describe('tools/minimatch-compat', () => {
  it('is callable, as minimatch 3 is for require() and default imports', () => {
    expect(minimatch('a/b.js', '**/*.js')).toBe(true);
    expect(minimatch('a/b.ts', '**/*.js')).toBe(false);
  });

  it('is the same function as the named export of minimatch 10 and 11', () => {
    expect(require('./index.js')).toBe(minimatch);
  });

  it('has the rest of the API that old and new consumers use', () => {
    expect(new Minimatch('*.js').match('a.js')).toBe(true);
    expect(match(['a.js', 'b.ts'], '*.js')).toEqual(['a.js']);
    expect(['a.js', 'b.ts'].filter(filter('*.js'))).toEqual(['a.js']);
    expect(braceExpand('a{b,c}')).toEqual(['ab', 'ac']);
    expect(escape('a*b')).toBe('a\\*b');
    expect(unescape('a\\*b')).toBe('a*b');
    expect(sep).toBe('/');
    expect(typeof GLOBSTAR).toBe('symbol');
    expect(typeof defaults({ dot: true })).toBe('function');
  });

  it('is built on a release that has the fix for GHSA-g3hv-75wg-m249 (11.0.1)', () => {
    const upstream: unknown = JSON.parse(
      readFileSync(require.resolve('minimatch-upstream/package.json'), 'utf8'),
    );
    const version = isRecord(upstream) ? String(upstream.version) : '';
    const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);

    expect(major > 11 || (major === 11 && (minor > 0 || patch >= 1))).toBe(
      true,
    );
  });
});
