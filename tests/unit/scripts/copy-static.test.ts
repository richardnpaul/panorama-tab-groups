import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Copy } from '../../../scripts/lib/static-assets.js';

const cpSync = vi.fn<Copy>();
const statSync = vi.fn<(path: string) => { isDirectory: () => boolean }>();
vi.mock('node:fs', () => ({
  cpSync: (...args: Parameters<Copy>) => {
    cpSync(...args);
  },
  statSync: (path: string) => statSync(path),
}));

/** The filter that the script handed to the copy */
const copiedFilter = (): ((sourcePath: string) => boolean) => {
  const options = cpSync.mock.calls[0]?.[2];
  if (!options) {
    throw new Error('Nothing was copied');
  }
  return options.filter;
};

describe('scripts/copy-static.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    cpSync.mockClear();
    statSync.mockReset();
  });

  it('copies src to dist recursively with a static-asset filter', async () => {
    await import('../../../scripts/copy-static.js');

    expect(cpSync).toHaveBeenCalledTimes(1);
    expect(cpSync).toHaveBeenCalledWith('src', 'dist', {
      recursive: true,
      filter: copiedFilter(),
    });
    expect(copiedFilter()).toBeTypeOf('function');
  });

  it('decides what is a directory with fs.statSync', async () => {
    await import('../../../scripts/copy-static.js');
    const filter = copiedFilter();
    statSync.mockReturnValueOnce({ isDirectory: () => true });
    statSync.mockReturnValueOnce({ isDirectory: () => false });

    expect(filter('src/js')).toBe(true);
    expect(filter('src/js/a.js')).toBe(false);
    expect(statSync).toHaveBeenNthCalledWith(1, 'src/js');
    expect(statSync).toHaveBeenNthCalledWith(2, 'src/js/a.js');
  });
});
