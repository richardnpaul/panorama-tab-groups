import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forEachTab,
  forEachTabSync,
  getAllTabsInWindow,
  getGroupId,
  setGroupId,
} from '../../../src/js/view/tabs.js';

const setTabValue = vi.fn();
const getTabValue = vi.fn();
const query = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  setTabValue.mockResolvedValue(undefined);
  getTabValue.mockResolvedValue(42);
  query.mockResolvedValue([{ id: 1 }, { id: 2 }]);
  Object.assign(globalThis, {
    browser: {
      sessions: { setTabValue, getTabValue },
      tabs: { query },
    },
  });
});

describe('view/tabs.ts', () => {
  describe('setGroupId', () => {
    it('stores the group id on the tab as an integer', async () => {
      await setGroupId(101, '42');

      expect(setTabValue).toHaveBeenCalledTimes(1);
      expect(setTabValue).toHaveBeenCalledWith(101, 'groupId', 42);
    });

    it('accepts a number and truncates it to an integer', async () => {
      await setGroupId(7, 3.9);

      expect(setTabValue).toHaveBeenCalledWith(7, 'groupId', 3);
    });

    it('waits for the browser to store the value', async () => {
      let stored = false;
      setTabValue.mockImplementation(async () => {
        await Promise.resolve();
        stored = true;
      });

      await setGroupId(1, 1);

      expect(stored).toBe(true);
    });

    it('stores NaN for a value that is not a number', async () => {
      await setGroupId(1, 'abc');

      expect(setTabValue).toHaveBeenCalledWith(1, 'groupId', NaN);
    });
  });

  describe('getGroupId', () => {
    it('returns whatever the browser stored for the tab', async () => {
      await expect(getGroupId(101)).resolves.toBe(42);

      expect(getTabValue).toHaveBeenCalledTimes(1);
      expect(getTabValue).toHaveBeenCalledWith(101, 'groupId');
    });

    it('returns undefined when nothing is stored', async () => {
      getTabValue.mockResolvedValue(undefined);

      await expect(getGroupId(5)).resolves.toBeUndefined();
    });
  });

  describe('getAllTabsInWindow', () => {
    it('queries the tabs of the current window', async () => {
      await expect(getAllTabsInWindow()).resolves.toEqual([
        { id: 1 },
        { id: 2 },
      ]);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith({ currentWindow: true });
    });
  });

  describe('forEachTab', () => {
    it('calls the callback once per tab with only the tab', async () => {
      const callback = vi.fn().mockResolvedValue(undefined);

      await forEachTab(callback);

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(1, { id: 1 });
      expect(callback).toHaveBeenNthCalledWith(2, { id: 2 });
    });

    it('waits for every callback to finish', async () => {
      const finished: (number | undefined)[] = [];
      const callback = vi.fn(async (tab: browser.tabs.Tab) => {
        await Promise.resolve();
        finished.push(tab.id);
      });

      await forEachTab(callback);

      expect(finished).toEqual([1, 2]);
    });

    it('starts every callback even if one throws synchronously', async () => {
      const callback = vi.fn((tab: browser.tabs.Tab) => {
        if (tab.id === 1) {
          throw new Error('first tab failed');
        }
        return Promise.resolve();
      });

      await expect(forEachTab(callback)).rejects.toThrow('first tab failed');

      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('does nothing for a window without tabs', async () => {
      query.mockResolvedValue([]);
      const callback = vi.fn();

      await forEachTab(callback);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('forEachTabSync', () => {
    it('calls the callback in order with only the tab', async () => {
      const callback = vi.fn();

      await forEachTabSync(callback);

      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenNthCalledWith(1, { id: 1 });
      expect(callback).toHaveBeenNthCalledWith(2, { id: 2 });
    });
  });
});
