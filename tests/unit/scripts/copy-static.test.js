import { vi } from 'vitest';

const cpSync = vi.fn();
const statSync = vi.fn();
vi.mock('node:fs', () => ({
  cpSync: (...args) => cpSync(...args),
  statSync: (...args) => statSync(...args),
}));

describe('scripts/copy-static.mjs', () => {
  beforeEach(() => {
    vi.resetModules();
    cpSync.mockClear();
    statSync.mockReset();
  });

  it('copies src to dist recursively with a static-asset filter', async () => {
    await import('../../../scripts/copy-static.mjs');

    expect(cpSync).toHaveBeenCalledTimes(1);
    expect(cpSync).toHaveBeenCalledWith('src', 'dist', {
      recursive: true,
      filter: expect.any(Function),
    });
  });

  it('decides what is a directory with fs.statSync', async () => {
    await import('../../../scripts/copy-static.mjs');
    const { filter } = cpSync.mock.calls[0][2];
    statSync.mockReturnValueOnce({ isDirectory: () => true });
    statSync.mockReturnValueOnce({ isDirectory: () => false });

    expect(filter('src/js')).toBe(true);
    expect(filter('src/js/a.js')).toBe(false);
    expect(statSync).toHaveBeenNthCalledWith(1, 'src/js');
    expect(statSync).toHaveBeenNthCalledWith(2, 'src/js/a.js');
  });
});
