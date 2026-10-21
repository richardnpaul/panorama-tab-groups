import * as groups from '../../../src/js/view/groups.js';
import {
  PANORAMA_VIEW_GROUP_ID,
  UNGROUPED_GROUP_ID,
} from '../../../src/js/background/constants.js';

beforeEach(async () => {
  vi.clearAllMocks();

  globalThis.browser = {
    windows: {
      getCurrent: vi.fn().mockResolvedValue({ id: 1 }),
    },
    sessions: {
      getWindowValue: vi.fn().mockImplementation((winId, key) => {
        if (key === 'groups') {
          return [
            { id: 1, name: 'Group 1' },
            { id: 2, name: 'Group 2' },
            { id: UNGROUPED_GROUP_ID, name: 'Ungrouped' },
            { id: PANORAMA_VIEW_GROUP_ID, name: 'View' },
            { id: -3, name: 'Negative Group' },
          ];
        }
        if (key === 'groupIndex') return 3;
        if (key === 'activeGroup') return 1;
        return undefined;
      }),
      setWindowValue: vi.fn().mockResolvedValue(),
      getTabValue: vi.fn().mockImplementation((tabId, key) => {
        if (key === 'groupId') {
          return tabId === 101 ? 1 : 2;
        }
        return undefined;
      }),
    },
    i18n: {
      getMessage: vi.fn(() => 'Group '),
    },
    runtime: {
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 101 }, { id: 102 }]),
    },
  };

  // Initialize groups module before each test
  await groups.init();
});

describe('view/groups.js', () => {
  describe('init', () => {
    it('filters out system and negative groups', async () => {
      // It should only contain Group 1 and Group 2, not -1, -2, or -3
      expect(groups.getLength()).toBe(2);
      expect(groups.getIds()).toEqual([1, 2]);
    });

    it('handles null/undefined groups list in session', async () => {
      globalThis.browser.sessions.getWindowValue.mockImplementationOnce(
        (winId, key) => {
          if (key === 'groups') return null;
          return undefined;
        },
      );
      await groups.init();
      expect(groups.getLength()).toBe(0);
    });
  });

  describe('create', () => {
    it('creates a new group and saves it', async () => {
      const group = await groups.create();

      expect(group.id).toBe(3); // previous groupIndex was 3
      expect(group.name).toBe('Group 3');
      expect(groups.getLength()).toBe(3);

      expect(globalThis.browser.sessions.setWindowValue).toHaveBeenCalledWith(
        1,
        'groupIndex',
        4,
      );
      expect(globalThis.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'createMenuItem',
        groupId: '3',
        groupName: 'Group 3',
      });
      expect(globalThis.browser.sessions.setWindowValue).toHaveBeenCalledWith(
        1,
        'groups',
        expect.any(Array),
      );
    });

    it('uses 0 as fallback UID if groupIndex is missing', async () => {
      globalThis.browser.sessions.getWindowValue.mockImplementation(
        (winId, key) => {
          if (key === 'groupIndex') return null;
          return undefined;
        },
      );
      const group = await groups.create();
      expect(group.id).toBe(0);
    });
  });

  describe('remove', () => {
    it('removes a group and delegates to background', async () => {
      await groups.remove(1);

      // tab 101 is in group 1, tab 102 is in group 2
      expect(globalThis.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'deleteGroup',
        groupId: 1,
        windowId: 1,
        nativeGroupId: undefined,
        tabIds: [101],
      });

      expect(groups.getLength()).toBe(1);
      expect(groups.getIds()).toEqual([2]);
    });

    it('does nothing if group does not exist', async () => {
      await groups.remove(99);
      expect(globalThis.browser.runtime.sendMessage).not.toHaveBeenCalled();
      expect(groups.getLength()).toBe(2);
    });

    it('handles failed deletion from background', async () => {
      globalThis.browser.runtime.sendMessage.mockResolvedValueOnce({
        success: false,
        error: 'Failed',
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();

      await groups.remove(1);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete group 1:',
        'Failed',
      );
      // Group should not be removed from local state
      expect(groups.getLength()).toBe(2);

      consoleSpy.mockRestore();
    });

    it('handles empty response on deleteGroup failure', async () => {
      globalThis.browser.runtime.sendMessage.mockResolvedValueOnce(null);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation();

      await groups.remove(1);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete group 1:',
        'No response',
      );
      consoleSpy.mockRestore();
    });
  });

  describe('rename', () => {
    it('renames a group and sends message', async () => {
      await groups.rename(1, 'New Name');

      expect(groups.getName(1)).toBe('New Name');
      expect(globalThis.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'updateMenuItem',
        groupId: '1',
        groupName: 'New Name',
      });
      expect(globalThis.browser.sessions.setWindowValue).toHaveBeenCalled();
    });

    it('does nothing if group does not exist', async () => {
      await groups.rename(99, 'New Name');
      expect(globalThis.browser.runtime.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('transform', () => {
    it('updates group rect and lastMoved', async () => {
      const rect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
      await groups.transform(1, rect);

      const group = groups.get(1);
      expect(group.rect).toEqual(rect);
      expect(group.lastMoved).toBeDefined();
      expect(globalThis.browser.sessions.setWindowValue).toHaveBeenCalled();
    });

    it('does nothing if group does not exist', async () => {
      await groups.transform(99, {});
      expect(globalThis.browser.sessions.setWindowValue).not.toHaveBeenCalled();
    });
  });

  describe('getActive and setActive', () => {
    it('gets active group', async () => {
      const active = await groups.getActive();
      expect(active).toBe(1);
    });

    it('sets active group', async () => {
      await groups.setActive(2);
      expect(globalThis.browser.sessions.setWindowValue).toHaveBeenCalledWith(
        1,
        'activeGroup',
        2,
      );
    });
  });

  describe('get', () => {
    it('returns the group object', () => {
      const group = groups.get(1);
      expect(group.name).toBe('Group 1');
    });

    it('returns null if group does not exist', () => {
      expect(groups.get(99)).toBeNull();
    });
  });

  describe('forEach', () => {
    it('iterates over all groups', () => {
      const cb = vi.fn();
      groups.forEach(cb);
      expect(cb).toHaveBeenCalledTimes(2);
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    });
  });
});
