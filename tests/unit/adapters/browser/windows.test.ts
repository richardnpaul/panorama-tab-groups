import { describe, expect, it, vi } from 'vitest';
import { createBrowserWindows } from '../../../../src/js/adapters/browser/windows.js';
import { createMemoryWindows } from '../../../../src/js/adapters/memory/windows.js';

describe('adapters/browser/windows.ts', () => {
  it('gives the id of the current window', async () => {
    const getCurrent = vi.fn().mockResolvedValue({ id: 12 });
    const windows = createBrowserWindows(() => ({ windows: { getCurrent } }));

    await expect(windows.currentWindowId()).resolves.toBe(12);

    expect(getCurrent).toHaveBeenCalledTimes(1);
  });

  it('accepts window id 0', async () => {
    const windows = createBrowserWindows(() => ({
      windows: { getCurrent: vi.fn().mockResolvedValue({ id: 0 }) },
    }));

    await expect(windows.currentWindowId()).resolves.toBe(0);
  });

  it('fails when the browser does not say which window this is', async () => {
    const windows = createBrowserWindows(() => ({
      windows: { getCurrent: vi.fn().mockResolvedValue({}) },
    }));

    await expect(windows.currentWindowId()).rejects.toThrow(
      'No current window',
    );
  });

  it('uses the browser that exists when it is called', async () => {
    let getCurrent = vi.fn().mockResolvedValue({ id: 1 });
    const windows = createBrowserWindows(() => ({ windows: { getCurrent } }));
    getCurrent = vi.fn().mockResolvedValue({ id: 2 });

    await expect(windows.currentWindowId()).resolves.toBe(2);
  });
});

describe('adapters/memory/windows.ts', () => {
  it('is the window it was given', async () => {
    await expect(createMemoryWindows(5).currentWindowId()).resolves.toBe(5);
  });

  it('can be moved to another window', async () => {
    const windows = createMemoryWindows(5);

    windows.setCurrent(8);

    await expect(windows.currentWindowId()).resolves.toBe(8);
  });
});
