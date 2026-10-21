import {
  setGroupId,
  getGroupId,
  getAllTabsInWindow,
  forEachTab,
  forEachTabSync,
} from '../../../src/js/view/tabs.js';

beforeEach(() => {
  jest.clearAllMocks();
  globalThis.browser = {
    sessions: {
      setTabValue: jest.fn().mockResolvedValue(),
      getTabValue: jest.fn().mockResolvedValue(42),
    },
    tabs: {
      query: jest.fn().mockResolvedValue([{ id: 1 }, { id: 2 }]),
    },
  };
});

describe('view/tabs.js', () => {
  describe('setGroupId', () => {
    it('sets the tab value as an integer', async () => {
      await setGroupId(101, '42');
      expect(globalThis.browser.sessions.setTabValue).toHaveBeenCalledWith(
        101,
        'groupId',
        42,
      );
    });
  });

  describe('getGroupId', () => {
    it('returns the tab value', async () => {
      const result = await getGroupId(101);
      expect(result).toBe(42);
      expect(globalThis.browser.sessions.getTabValue).toHaveBeenCalledWith(
        101,
        'groupId',
      );
    });
  });

  describe('getAllTabsInWindow', () => {
    it('queries tabs in the current window', async () => {
      const result = await getAllTabsInWindow();
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
      expect(globalThis.browser.tabs.query).toHaveBeenCalledWith({
        currentWindow: true,
      });
    });
  });

  describe('forEachTab', () => {
    it('executes callback asynchronously for all tabs', async () => {
      const callback = jest.fn().mockResolvedValue();
      await forEachTab(callback);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith({ id: 1 });
      expect(callback).toHaveBeenCalledWith({ id: 2 });
    });
  });

  describe('forEachTabSync', () => {
    it('executes callback synchronously for all tabs', async () => {
      const callback = jest.fn();
      await forEachTabSync(callback);
      expect(callback).toHaveBeenCalledTimes(2);
      expect(callback).toHaveBeenCalledWith({ id: 1 });
      expect(callback).toHaveBeenCalledWith({ id: 2 });
    });
  });
});
