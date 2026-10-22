import { describe, expect, it, vi } from 'vitest';
import { createBrowserWindows } from '../../../../src/js/adapters/browser/windows.js';
import { createMemoryWindows } from '../../../../src/js/adapters/memory/windows.js';

const windowsApi = (
  getCurrent = vi.fn().mockResolvedValue({ id: 1 }),
  getLastFocused = vi.fn().mockResolvedValue({ id: 2 }),
  get = vi.fn().mockResolvedValue({ id: 3 }),
  getAll = vi.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
) => ({ windows: { getCurrent, getLastFocused, get, getAll } });

describe('adapters/browser/windows.ts', () => {
  describe('currentWindowId', () => {
    it('gives the id of the current window', async () => {
      const getCurrent = vi.fn().mockResolvedValue({ id: 12 });
      const windows = createBrowserWindows(() => windowsApi(getCurrent));

      await expect(windows.currentWindowId()).resolves.toBe(12);

      expect(getCurrent).toHaveBeenCalledTimes(1);
    });

    it('accepts window id 0', async () => {
      const windows = createBrowserWindows(() =>
        windowsApi(vi.fn().mockResolvedValue({ id: 0 })),
      );

      await expect(windows.currentWindowId()).resolves.toBe(0);
    });

    it('fails when the browser does not say which window this is', async () => {
      const windows = createBrowserWindows(() =>
        windowsApi(vi.fn().mockResolvedValue({})),
      );

      await expect(windows.currentWindowId()).rejects.toThrow(
        'No current window',
      );
    });

    it('uses the browser that exists when it is called', async () => {
      let getCurrent = vi.fn().mockResolvedValue({ id: 1 });
      const windows = createBrowserWindows(() => windowsApi(getCurrent));
      getCurrent = vi.fn().mockResolvedValue({ id: 2 });

      await expect(windows.currentWindowId()).resolves.toBe(2);
    });
  });

  describe('lastFocusedWindowId', () => {
    it('gives the id of the window used last', async () => {
      const getLastFocused = vi.fn().mockResolvedValue({ id: 33 });
      const windows = createBrowserWindows(() =>
        windowsApi(undefined, getLastFocused),
      );

      await expect(windows.lastFocusedWindowId()).resolves.toBe(33);

      expect(getLastFocused).toHaveBeenCalledTimes(1);
    });

    it('does not ask for the current window', async () => {
      const getCurrent = vi.fn().mockResolvedValue({ id: 1 });
      const windows = createBrowserWindows(() => windowsApi(getCurrent));

      await windows.lastFocusedWindowId();

      expect(getCurrent).not.toHaveBeenCalled();
    });

    it('fails when the browser does not say which window it was', async () => {
      const windows = createBrowserWindows(() =>
        windowsApi(undefined, vi.fn().mockResolvedValue({})),
      );

      await expect(windows.lastFocusedWindowId()).rejects.toThrow(
        'No current window',
      );
    });
  });
});

describe('adapters/browser/windows.ts: listIds', () => {
  it('lists the ids of all the windows', async () => {
    const getAll = vi.fn().mockResolvedValue([{ id: 4 }, { id: 0 }]);
    const windows = createBrowserWindows(() =>
      windowsApi(undefined, undefined, undefined, getAll),
    );

    await expect(windows.listIds()).resolves.toEqual([4, 0]);

    expect(getAll).toHaveBeenCalledTimes(1);
    expect(getAll).toHaveBeenCalledWith({});
  });

  it('leaves out a window that has no id', async () => {
    const windows = createBrowserWindows(() =>
      windowsApi(
        undefined,
        undefined,
        undefined,
        vi.fn().mockResolvedValue([{}, { id: 2 }]),
      ),
    );

    await expect(windows.listIds()).resolves.toEqual([2]);
  });
});

describe('adapters/browser/windows.ts: exists', () => {
  it('is true for a window the browser knows', async () => {
    const get = vi.fn().mockResolvedValue({ id: 7 });
    const windows = createBrowserWindows(() =>
      windowsApi(undefined, undefined, get),
    );

    await expect(windows.exists(7)).resolves.toBe(true);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(7);
  });

  it('is false for a window that no longer exists', async () => {
    const windows = createBrowserWindows(() =>
      windowsApi(
        undefined,
        undefined,
        vi.fn().mockRejectedValue(new Error('Invalid window ID: 7')),
      ),
    );

    await expect(windows.exists(7)).resolves.toBe(false);
  });
});

describe('adapters/memory/windows.ts', () => {
  it('is the window it was given, and that is also the one used last', async () => {
    const windows = createMemoryWindows(5);

    await expect(windows.currentWindowId()).resolves.toBe(5);
    await expect(windows.lastFocusedWindowId()).resolves.toBe(5);
  });

  it('can be given a different window that was used last', async () => {
    const windows = createMemoryWindows(5, 9);

    await expect(windows.currentWindowId()).resolves.toBe(5);
    await expect(windows.lastFocusedWindowId()).resolves.toBe(9);
  });

  it('knows the windows it was given, and no others', async () => {
    const windows = createMemoryWindows(5, 9);

    await expect(windows.exists(5)).resolves.toBe(true);
    await expect(windows.exists(9)).resolves.toBe(true);
    await expect(windows.exists(6)).resolves.toBe(false);
  });

  it('lists the windows it knows', async () => {
    const windows = createMemoryWindows(5, 9);
    windows.open(6);
    windows.close(5);

    await expect(windows.listIds()).resolves.toEqual([9, 6]);
  });

  it('can open and close windows', async () => {
    const windows = createMemoryWindows(5);

    windows.open(6);
    await expect(windows.exists(6)).resolves.toBe(true);

    windows.close(6);
    await expect(windows.exists(6)).resolves.toBe(false);
  });

  it('can be moved to other windows', async () => {
    const windows = createMemoryWindows(5);

    windows.setCurrent(8);
    windows.setLastFocused(3);

    await expect(windows.currentWindowId()).resolves.toBe(8);
    await expect(windows.lastFocusedWindowId()).resolves.toBe(3);
  });

  it('opens a window it is moved to', async () => {
    const windows = createMemoryWindows(5);

    windows.setCurrent(8);
    windows.setLastFocused(3);

    await expect(windows.exists(8)).resolves.toBe(true);
    await expect(windows.exists(3)).resolves.toBe(true);
  });
});
