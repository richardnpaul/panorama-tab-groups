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
  });
});
