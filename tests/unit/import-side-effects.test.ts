// @vitest-environment jsdom
/// <reference types="vite/client" />
import { afterEach, describe, expect, it, vi } from 'vitest';

// The scripts a page or the background loads; they start things on purpose
const ENTRY_POINTS = [
  'src/js/background/main.ts',
  'src/js/polyfill.ts',
  'src/js/view/index.ts',
  'src/js/options/index.ts',
  'src/js/migration-status/index.ts',
  'src/popup-view/index.ts',
];

// Every module under src, each as a function that imports it. The pattern is
// read by Vite, which is what lets a path that varies be imported
const IMPORTERS = import.meta.glob<unknown>('../../src/**/*.ts');

const MODULES = Object.keys(IMPORTERS)
  .map((path) => path.replace('../../', ''))
  .filter((path) => !path.endsWith('.d.ts') && !ENTRY_POINTS.includes(path));

/** A browser that remembers every part of it that is touched */
function watchedBrowser(touched: string[]): object {
  const watch = (path: string): object =>
    new Proxy(() => undefined, {
      get: (_target, key) => {
        const next = `${path}.${String(key)}`;
        touched.push(next);
        return watch(next);
      },
      apply: () => {
        touched.push(`${path}()`);
        return undefined;
      },
    });
  return watch('browser');
}

describe('importing a module', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('finds the modules to check', () => {
    expect(MODULES.length).toBeGreaterThan(100);
    expect(MODULES).toContain('src/js/options/start.ts');
  });

  it.each(MODULES)('%s does not touch the browser', async (path) => {
    vi.resetModules();
    const touched: string[] = [];
    vi.stubGlobal('browser', watchedBrowser(touched));

    const importer = IMPORTERS[`../../${path}`];
    if (importer === undefined) {
      throw new Error(`${path} is not among the modules found`);
    }
    await importer();

    expect(touched).toEqual([]);
  });
});
