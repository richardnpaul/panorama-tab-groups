import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createDefaultOptions } from '../../src/js/core/options.js';

// docs/spec.md lists everything the extension keeps (section 2). This keeps that list true: the
// keys it names are the keys the adapters use, no more and no fewer.

const ADAPTERS = 'src/js/adapters/browser';

const adapterSources = (): string =>
  readdirSync(ADAPTERS)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(`${ADAPTERS}/${file}`, 'utf8'))
    .join('\n');

/** How the table names where a key is kept, and how this test does */
const KEPT_AS: Record<string, string> = {
  'value of a window': 'window',
  'value of a tab': 'tab',
  'storage.local': 'local',
  'storage.sync': 'sync',
};

/** The keys the table of the spec names, as `where:key` */
function keysInSpec(): string[] {
  const spec = readFileSync('docs/spec.md', 'utf8');
  return [...spec.matchAll(/^\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/gmu)].flatMap(
    ([, key = '', kept = '']) => {
      const where = KEPT_AS[kept.replaceAll('`', '').trim()];
      return where === undefined ? [] : [`${where}:${key}`];
    },
  );
}

/** The keys the adapters read and write, as `where:key` */
function keysInCode(): string[] {
  const code = adapterSources();
  const sessionValues = [
    ...code.matchAll(
      /(?:get|set|remove)(Window|Tab)Value\(\s*\w+,\s*'([A-Za-z_]+)'/gu,
    ),
  ].map(([, scope = '', key = '']) => `${scope.toLowerCase()}:${key}`);
  const local = [
    ...code.matchAll(/(?:const KEY|const STORAGE_KEY) = '([A-Za-z_]+)'/gu),
  ].map(([, key = '']) => `local:${key}`);
  // The options are the keys of the defaults; the one older versions kept is still read
  const sync = [
    ...Object.keys(createDefaultOptions('1.0', true)),
    ...(/useDarkTheme/u.test(code) ? ['useDarkTheme'] : []),
  ].map((key) => `sync:${key}`);
  return [...new Set([...sessionValues, ...local, ...sync])];
}

describe('what the extension stores', () => {
  it('finds the keys, in the table and in the code', () => {
    expect(keysInSpec().length).toBeGreaterThan(10);
    expect(keysInCode().length).toBeGreaterThan(10);
  });

  it('is the same in docs/spec.md and in the adapters', () => {
    const inSpec = new Set(keysInSpec());
    const inCode = new Set(keysInCode());

    expect({
      inCodeButNotInSpec: [...inCode].filter((key) => !inSpec.has(key)).sort(),
      inSpecButNotInCode: [...inSpec].filter((key) => !inCode.has(key)).sort(),
    }).toEqual({ inCodeButNotInSpec: [], inSpecButNotInCode: [] });
  });

  it('names no key twice in the table', () => {
    const keys = keysInSpec();

    expect(new Set(keys).size).toBe(keys.length);
  });
});
