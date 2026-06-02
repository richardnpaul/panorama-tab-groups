import { stateManager } from '../../src/js/background/StateManager.js';

// We need to define `globalThis.browser` BEFORE StateManager's methods are called.
// We'll set it up in a beforeEach block.

let getWindowValueMock;
let setWindowValueMock;
let getTabValueMock;
let setTabValueMock;
let storageLocalGetMock;
let storageLocalSetMock;

beforeEach(() => {
  getWindowValueMock = {};
  setWindowValueMock = {};
  getTabValueMock = {};
  setTabValueMock = {};
  storageLocalGetMock = {};
  storageLocalSetMock = {};

  globalThis.browser = {
    sessions: {
      getWindowValue: async (windowId, key) =>
        getWindowValueMock[`${windowId}_${key}`],
      setWindowValue: async (windowId, key, value) => {
        setWindowValueMock[`${windowId}_${key}`] = value;
        getWindowValueMock[`${windowId}_${key}`] = value; // Update the get mock to simulate persistence
      },
      getTabValue: async (tabId, key) => getTabValueMock[`${tabId}_${key}`],
      setTabValue: async (tabId, key, value) => {
        setTabValueMock[`${tabId}_${key}`] = value;
        getTabValueMock[`${tabId}_${key}`] = value;
      },
    },
    storage: {
      local: {
        get: async (keys) => {
          if (typeof keys === 'string') {
            return { [keys]: storageLocalGetMock[keys] };
          }
          return storageLocalGetMock;
        },
        set: async (obj) => {
          Object.assign(storageLocalSetMock, obj);
          Object.assign(storageLocalGetMock, obj);
        },
      },
    },
  };
});

describe('StateManager Unit Tests', () => {
  describe('Tab Group Assignments', () => {
    it('getGroups returns undefined if nothing is set', async () => {
      const groups = await stateManager.getGroups(1);
      expect(groups).toBeUndefined();
    });

    it('setGroups creates UNGROUPED_GROUP_ID if missing', async () => {
      await stateManager.setGroups(1, [{ id: 1, name: 'Group 1' }]);

      const savedGroups = setWindowValueMock['1_groups'];
      expect(savedGroups).toBeDefined();
      expect(savedGroups.length).toBe(2);
      expect(savedGroups[1].id).toBe(-2); // UNGROUPED_GROUP_ID
      expect(savedGroups[1].name).toBe('Ungrouped Tabs');
      expect(savedGroups[1].isSystemGroup).toBe(true);
    });

    it('setGroups handles undefined groups gracefully', async () => {
      await stateManager.setGroups(1, undefined);
      const savedGroups = setWindowValueMock['1_groups'];
      expect(savedGroups).toBeDefined();
      expect(savedGroups.length).toBe(1);
      expect(savedGroups[0].id).toBe(-2);
    });

    it('setGroups updates existing UNGROUPED_GROUP_ID', async () => {
      await stateManager.setGroups(1, [
        { id: 1, name: 'Group 1' },
        { id: -2, name: 'Custom Name', nativeGroupId: 99 },
      ]);

      const savedGroups = setWindowValueMock['1_groups'];
      expect(savedGroups.length).toBe(2);
      expect(savedGroups[1].name).toBe('Ungrouped Tabs'); // Should be overridden
      expect(savedGroups[1].nativeGroupId).toBeNull(); // Should be overridden
    });
  });

  describe('Active Group Management', () => {
    it('getActiveGroup returns undefined if not set', async () => {
      const active = await stateManager.getActiveGroup(1);
      expect(active).toBeUndefined();
    });

    it('setActiveGroup updates the value', async () => {
      await stateManager.setActiveGroup(1, 42);
      expect(setWindowValueMock['1_activeGroup']).toBe(42);

      const active = await stateManager.getActiveGroup(1);
      expect(active).toBe(42);
    });

    it('setActiveGroup throws error on failure', async () => {
      const originalSet = globalThis.browser.sessions.setWindowValue;
      globalThis.browser.sessions.setWindowValue = async () => {
        throw new Error('Test error');
      };
      await expect(stateManager.setActiveGroup(1, 42)).rejects.toThrow(
        'Test error',
      );
      globalThis.browser.sessions.setWindowValue = originalSet;
    });
  });

  describe('Group Index Management', () => {
    it('getGroupIndex and setGroupIndex work correctly', async () => {
      await stateManager.setGroupIndex(1, 5);
      expect(setWindowValueMock['1_groupIndex']).toBe(5);
      const index = await stateManager.getGroupIndex(1);
      expect(index).toBe(5);
    });
  });

  describe('Tab Group ID Management', () => {
    it('getTabGroup and setTabGroup work correctly', async () => {
      await stateManager.setTabGroup(100, '5');
      expect(setTabValueMock['100_groupId']).toBe(5); // Should parseInt
      const groupId = await stateManager.getTabGroup(100);
      expect(groupId).toBe(5);
    });

    it('getTabGroups returns multiple group IDs', async () => {
      await stateManager.setTabGroup(101, 1);
      await stateManager.setTabGroup(102, 2);
      const groups = await stateManager.getTabGroups([101, 102]);
      expect(groups).toEqual([1, 2]);
    });
  });

  describe('Background State (Persistent)', () => {
    it('getBackgroundState returns defaults if not set', async () => {
      const state = await stateManager.getBackgroundState();
      expect(state).toEqual({
        openingView: null,
        openingBackup: false,
      });
    });

    it('setBackgroundState updates the storage', async () => {
      await stateManager.setBackgroundState({
        openingView: { tabId: 1 },
        openingBackup: true,
      });

      expect(storageLocalSetMock.backgroundState.openingBackup).toBe(true);

      const state = await stateManager.getBackgroundState();
      expect(state.openingBackup).toBe(true);
    });

    it('updateBackgroundState merges state correctly', async () => {
      await stateManager.setBackgroundState({
        openingBackup: true,
        otherVal: 1,
      });
      await stateManager.updateBackgroundState({
        openingBackup: false,
        newVal: 2,
      });
      const state = await stateManager.getBackgroundState();
      expect(state).toEqual({ openingBackup: false, otherVal: 1, newVal: 2 });
    });
  });

  describe('Window States', () => {
    it('getWindowState returns default if not set', async () => {
      const state = await stateManager.getWindowState(1);
      expect(state).toEqual({ viewTabId: null });
    });

    it('setWindowState and getWindowState work', async () => {
      await stateManager.setWindowState(1, { viewTabId: 100 });
      const state = await stateManager.getWindowState(1);
      expect(state).toEqual({ viewTabId: 100 });
    });

    it('removeWindowState removes the state', async () => {
      await stateManager.setWindowState(1, { viewTabId: 100 });
      await stateManager.removeWindowState(1);
      const state = await stateManager.getWindowState(1);
      expect(state).toEqual({ viewTabId: null });
    });
  });

  describe('Batch Operations', () => {
    it('getWindowGroupState and setWindowGroupState work', async () => {
      await stateManager.setWindowGroupState(1, [{ id: 1 }], 1);
      const state = await stateManager.getWindowGroupState(1);
      expect(state.groups.length).toBe(2); // UNGROUPED_GROUP_ID added
      expect(state.activeGroup).toBe(1);
    });
  });

  describe('Migration Helpers', () => {
    it('migrateBackgroundState saves state', async () => {
      await stateManager.migrateBackgroundState({ migrated: true });
      const state = await stateManager.getBackgroundState();
      expect(state.migrated).toBe(true);
    });
    it('migrateBackgroundState does nothing if null', async () => {
      await stateManager.setBackgroundState({});
      await stateManager.migrateBackgroundState(null);
      const state = await stateManager.getBackgroundState();
      expect(state.migrated).toBeUndefined();
    });

    it('migrateWindowStates saves legacy map', async () => {
      const map = new Map();
      map.set(1, { legacy: true });
      await stateManager.migrateWindowStates(map);
      const state = await stateManager.getWindowState(1);
      expect(state.legacy).toBe(true);
    });
    it('migrateWindowStates does nothing if map empty', async () => {
      await stateManager.setWindowState(1, { initial: true });
      await stateManager.migrateWindowStates(new Map());
      const state = await stateManager.getWindowState(1);
      expect(state.legacy).toBeUndefined();
    });
  });
});
