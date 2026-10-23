import { describe, expect, it, vi } from 'vitest';
import {
  type Copy,
  COMPILED_EXTENSIONS,
  copyStatic,
  createStaticAssetFilter,
} from '../../../scripts/lib/static-assets.js';

describe('scripts/lib/static-assets.js', () => {
  describe('COMPILED_EXTENSIONS', () => {
    it('lists exactly the extensions that tsc emits from src', () => {
      expect(COMPILED_EXTENSIONS).toEqual(['.js', '.ts']);
    });
  });

  describe('createStaticAssetFilter', () => {
    const isDirectory = (sourcePath: string) => sourcePath.endsWith('/');
    const filter = createStaticAssetFilter(isDirectory);

    it.each([
      'src/manifest.json',
      'src/view.html',
      'src/css/view.css',
      'src/icons/icon.svg',
      'src/icons/logo/logo-16.png',
      'src/_locales/en/messages.json',
      'src/.gitignore',
      'src/NOTICE',
    ])('copies the static asset %s', (sourcePath) => {
      expect(filter(sourcePath)).toBe(true);
    });

    it.each([
      'src/js/background.js',
      'src/js/background/StateManager.ts',
      'src/popup-view/index.js',
    ])('skips the compiled source %s', (sourcePath) => {
      expect(filter(sourcePath)).toBe(false);
    });

    it('always descends into directories, even ones that look like code', () => {
      expect(filter('src/js/')).toBe(true);
      expect(filter('src/vendor.js/')).toBe(true);
    });

    it('asks the directory check about the exact path it was given', () => {
      const check = vi
        .fn<(sourcePath: string) => boolean>()
        .mockReturnValue(true);

      createStaticAssetFilter(check)('src/js/background.js');

      expect(check).toHaveBeenCalledTimes(1);
      expect(check).toHaveBeenCalledWith('src/js/background.js');
    });
  });

  describe('copyStatic', () => {
    it('copies recursively from the source to the dist directory', () => {
      const cp = vi.fn<Copy>();

      copyStatic({
        srcDir: 'in',
        distDir: 'out',
        cp,
        isDirectory: () => false,
      });

      expect(cp).toHaveBeenCalledTimes(1);
      expect(cp).toHaveBeenCalledWith('in', 'out', {
        recursive: true,
        filter: cp.mock.calls[0]?.[2].filter,
      });
      expect(cp.mock.calls[0]?.[2].filter).toBeTypeOf('function');
    });

    it('passes a filter built from the given directory check', () => {
      const cp = vi.fn<Copy>();
      const isDirectory = (sourcePath: string) => sourcePath === 'in/js';

      copyStatic({ srcDir: 'in', distDir: 'out', cp, isDirectory });
      const filter = cp.mock.calls[0]?.[2].filter;
      if (!filter) {
        throw new Error('Nothing was copied');
      }

      expect(filter('in/js')).toBe(true);
      expect(filter('in/a.js')).toBe(false);
      expect(filter('in/a.json')).toBe(true);
    });
  });
});
