// @vitest-environment jsdom
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
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

const modulesIn = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return modulesIn(path);
    }
    return path.endsWith('.ts') && !path.endsWith('.d.ts') ? [path] : [];
  });

const MODULES = modulesIn('src')
  .map((path) => relative('.', path))
  .filter((path) => !ENTRY_POINTS.includes(path));

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

    await import(`../../${path.replace(/\.ts$/, '.js')}`);

    expect(touched).toEqual([]);
  });
});
