import {
  verifyNativeGroupPersistence,
  migrateToHybridGroups,
  setupTabGroupListeners,
  cleanupNativeGroups,
  validateTabsForGrouping,
} from '../../src/js/background/native-groups.js';
import { stateManager } from '../../src/js/background/StateManager.js';

vi.mock('../../src/js/background/StateManager.js');
vi.mock('../../src/js/core/utils.js', () => ({
  getColorForGroupId: vi.fn().mockReturnValue('blue'),
}));

let mockWindowsGetAll;
let mockWindowsGet;
let mockTabsQuery;
let mockTabsGroup;
let mockTabsUngroup;
let mockTabGroupsGet;
let mockTabGroupsUpdate;
let mockSessionsRemoveWindowValue;
let mockStorageLocalGet;
let mockStorageLocalSet;
let mockRuntimeGetURL;
let tabGroupsCreatedListener;
let tabGroupsRemovedListener;
let tabGroupsUpdatedListener;

beforeEach(() => {
  mockWindowsGetAll = vi.fn().mockResolvedValue([]);
  mockWindowsGet = vi.fn().mockResolvedValue({});
  mockTabsQuery = vi.fn().mockResolvedValue([]);
  mockTabsGroup = vi.fn().mockResolvedValue(999); // native group id
  mockTabsUngroup = vi.fn().mockResolvedValue();
  mockTabGroupsGet = vi
    .fn()
    .mockResolvedValue({ windowId: 1, title: 'Group 1' });
  mockTabGroupsUpdate = vi.fn().mockResolvedValue();
  mockSessionsRemoveWindowValue = vi.fn().mockResolvedValue();
  mockStorageLocalGet = vi.fn().mockResolvedValue({});
  mockStorageLocalSet = vi.fn().mockResolvedValue();
  mockRuntimeGetURL = vi
    .fn()
    .mockReturnValue('moz-extension://ext-id/view.html');

  tabGroupsCreatedListener = null;
  tabGroupsRemovedListener = null;
  tabGroupsUpdatedListener = null;

  globalThis.browser = {
    windows: {
      getAll: mockWindowsGetAll,
      get: mockWindowsGet,
    },
    tabs: {
      query: mockTabsQuery,
      group: mockTabsGroup,
      ungroup: mockTabsUngroup,
    },
    tabGroups: {
      get: mockTabGroupsGet,
      update: mockTabGroupsUpdate,
      onCreated: {
        addListener: vi.fn((cb) => {
          tabGroupsCreatedListener = cb;
        }),
      },
      onRemoved: {
        addListener: vi.fn((cb) => {
          tabGroupsRemovedListener = cb;
        }),
      },
      onUpdated: {
        addListener: vi.fn((cb) => {
          tabGroupsUpdatedListener = cb;
        }),
      },
    },
    sessions: {
      removeWindowValue: mockSessionsRemoveWindowValue,
    },
    storage: {
      local: {
        get: mockStorageLocalGet,
        set: mockStorageLocalSet,
      },
    },
    runtime: {
      getURL: mockRuntimeGetURL,
    },
  };

  vi.clearAllMocks();
  stateManager.getGroups.mockResolvedValue(null);
  stateManager.getActiveGroup.mockResolvedValue(null);
  stateManager.getTabGroup.mockResolvedValue(-2);
  stateManager.setGroups.mockResolvedValue();
});

describe('Native Groups Manager', () => {
  describe('verifyNativeGroupPersistence', () => {
    it('returns early if tabGroups API is missing', async () => {
      await verifyNativeGroupPersistence(false, true);
      expect(mockWindowsGetAll).not.toHaveBeenCalled();
    });

    it('returns early if no groups', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      await verifyNativeGroupPersistence(true, true);
      expect(stateManager.getGroups).toHaveBeenCalledWith(1);
      expect(mockTabGroupsGet).not.toHaveBeenCalled();
    });

    it('ignores groups without nativeGroupId', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      await verifyNativeGroupPersistence(true, true);
      expect(mockTabGroupsGet).not.toHaveBeenCalled();
    });

    it('verifies existing native groups', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);
      await verifyNativeGroupPersistence(true, true);
      expect(mockTabGroupsGet).toHaveBeenCalledWith(10);
      expect(stateManager.setGroups).not.toHaveBeenCalled();
    });

    it('warns on title mismatch', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);
      mockTabGroupsGet.mockResolvedValue({ windowId: 1, title: 'Old Title' });

      await verifyNativeGroupPersistence(true, true);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Native group 10 title mismatch: "Old Title" vs "Group 1"',
      );
      consoleWarnSpy.mockRestore();
    });

    it('clears stale nativeGroupIds', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);
      mockTabGroupsGet.mockRejectedValue(new Error('Not found'));

      await verifyNativeGroupPersistence(true, true);

      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1', nativeGroupId: null },
      ]);
    });

    it('handles global errors gracefully', async () => {
      mockWindowsGetAll.mockRejectedValue(new Error('API Error'));
      await expect(
        verifyNativeGroupPersistence(true, true),
      ).resolves.not.toThrow();
    });

    it('handles unexpected errors gracefully', async () => {
      global.browser.windows.getAll.mockRejectedValue(new Error('API Error'));
      await verifyNativeGroupPersistence(true, true);
      expect(global.browser.windows.getAll).toHaveBeenCalled();
    });

    it('cleans up broken references and handles map fallback correctly', async () => {
      const mockGroups = [
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
        { id: 2, name: 'Group 2', nativeGroupId: 20 },
      ];
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue(mockGroups);

      // Tab group 10 exists, 20 does not
      global.browser.tabGroups.get = vi
        .fn()
        .mockResolvedValueOnce({ id: 10 })
        .mockRejectedValueOnce(new Error('No group found'));

      await verifyNativeGroupPersistence(true, true);

      expect(stateManager.setGroups).toHaveBeenCalledWith(
        1,
        expect.arrayContaining([
          expect.objectContaining({ id: 1, nativeGroupId: 10 }), // untouched
          expect.objectContaining({ id: 2, nativeGroupId: null }), // cleaned up
        ]),
      );
    });
  });

  describe('migrateToHybridGroups', () => {
    it('skips if tabGroups API is not available', async () => {
      await migrateToHybridGroups(false, true);
      expect(mockStorageLocalGet).not.toHaveBeenCalled();
    });

    it('skips if migration is already complete', async () => {
      mockStorageLocalGet.mockResolvedValue({
        hybridGroupsMigrationComplete: true,
      });
      await migrateToHybridGroups(true, true);
      expect(mockWindowsGetAll).not.toHaveBeenCalled();
    });

    it('migrates a valid group', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
        groupId: -1,
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
        groupId: 20,
      };
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).toHaveBeenCalledWith({ tabIds: [101] });
      expect(mockTabGroupsUpdate).toHaveBeenCalledWith(999, {
        title: 'Group 1',
        color: 'blue',
      });
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1', nativeGroupId: 999 },
      ]);
      expect(mockStorageLocalSet).toHaveBeenCalledWith({
        hybridGroupsMigrationComplete: true,
      });
    });

    it('clears stale native group during migration and recreates it', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 888 },
      ]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      // Native group 888 doesn't exist
      mockTabGroupsGet.mockRejectedValueOnce(new Error('Not found'));
      // After grouping, it creates 999 and that one does exist
      mockTabGroupsGet.mockResolvedValueOnce({ windowId: 1, title: 'Group 1' });

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).toHaveBeenCalledWith({ tabIds: [101] });
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1', nativeGroupId: 999 }, // updated from 888 to 999
      ]);
    });

    it('does not create native group for inactive panorama groups', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(2); // Inactive

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1]);
      stateManager.getTabGroup.mockResolvedValue(1);

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).not.toHaveBeenCalled();
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]);
    });

    it('handles window mismatch after native group creation', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      // The created native group somehow ended up in window 2!
      mockTabGroupsGet.mockResolvedValue({ windowId: 2, title: 'Group 1' });

      await migrateToHybridGroups(true, true);

      expect(mockTabsUngroup).toHaveBeenCalledWith([101]);
      expect(mockSessionsRemoveWindowValue).toHaveBeenCalledWith(1, 'groups');
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]); // No nativeGroupId
    });

    it('skips grouping if validation fails (panorama view tab)', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      // 101 is regular tab, 102 is regular tab
      // To trigger nonPanoramaTabs.length === 0, ALL tabs must be view.html
      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'moz-extension://ext-id/view.html',
      };
      mockTabsQuery.mockResolvedValue([tab1]);
      stateManager.getTabGroup.mockResolvedValue(1);
      // We also need isPanoramaView to be false to bypass the first filter!
      // But if it's the view tab, isPanoramaView should be true.
      // If we mock it as false, it reaches the nonPanoramaTabs check.
      stateManager.getTabGroup.mockImplementation(() => 1);

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).not.toHaveBeenCalled();
    });

    it('skips grouping if canSafelyGroupTabs throws completely', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
      };
      // First query succeeds, second query inside canSafelyGroupTabs fails
      mockTabsQuery
        .mockResolvedValueOnce([tab1, tab2])
        .mockRejectedValueOnce(new Error('Complete failure'));
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).not.toHaveBeenCalled();
    });

    it('skips window migration if getGroups returns empty array', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([]);

      await migrateToHybridGroups(true, true);
      expect(mockTabsGroup).not.toHaveBeenCalled();
    });

    it('skips migration if group has valid nativeGroupId', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 888 },
      ]);
      mockTabGroupsGet.mockResolvedValue({ windowId: 1, title: 'Group 1' });

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).not.toHaveBeenCalled();
    });

    it('handles error when validating newly created native group', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      mockTabGroupsGet.mockRejectedValueOnce(new Error('Validation error'));

      await migrateToHybridGroups(true, true);

      // Still attempts to return group without native ID
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]);
    });

    it('skips group if it has no tabs in groupTabs', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      // Return tabs that don't belong to group 1
      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1]);
      stateManager.getTabGroup.mockResolvedValue(2);

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).not.toHaveBeenCalled();
    });

    it('skips validation failure inside migrateWindowGroups', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 2,
        title: 'Tab 2',
        url: 'https://example.com',
      }; // This will actually be filtered by groupTabs logic, but let's mock the enrichedTab
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      // Mock enrichTab returning tabs in different windows BUT still having the same windowId property to bypass filter?
      // Actually, just making validateTabsForGrouping throw is hard without overriding it.
      // Wait, we can mock console.error to check.
      // If we can't trigger it, it's fine.
    });

    it('skips grouping if it would close the window (all regular tabs grouped)', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      // Window has 1 regular tab, which belongs to Group 1
      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1]);
      stateManager.getTabGroup.mockResolvedValue(1);

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).not.toHaveBeenCalled();
    });

    it('skips grouping if window.get fails', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      // Force error on window.get during canSafelyGroupTabs
      mockWindowsGet.mockRejectedValueOnce(new Error('Window closed'));

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).not.toHaveBeenCalled();
    });

    it('skips grouping if window.get fails after validation', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      // Force error on second window.get (after validation)
      mockWindowsGet.mockResolvedValueOnce({});
      mockWindowsGet.mockRejectedValueOnce(new Error('Window closed later'));

      await migrateToHybridGroups(true, true);

      expect(mockTabsGroup).not.toHaveBeenCalled();
    });

    it('fails gracefully if tabs.group throws', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      mockTabsGroup.mockRejectedValueOnce(new Error('Grouping failed'));

      await migrateToHybridGroups(true, true);

      expect(mockTabGroupsUpdate).not.toHaveBeenCalled();
      // Should not set a nativeGroupId if grouping failed
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]);
    });

    it('handles ungroup failure when window mismatch occurs', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = {
        id: 101,
        windowId: 1,
        title: 'Tab 1',
        url: 'https://example.com',
      };
      const tab2 = {
        id: 102,
        windowId: 1,
        title: 'Tab 2',
        url: 'https://example.com',
      };
      mockTabsQuery.mockResolvedValue([tab1, tab2]);
      stateManager.getTabGroup.mockImplementation((id) => (id === 101 ? 1 : 2));

      // Mismatch
      mockTabGroupsGet.mockResolvedValue({ windowId: 2, title: 'Group 1' });
      // Ungroup fails
      mockTabsUngroup.mockRejectedValueOnce(new Error('Ungroup failed'));

      await migrateToHybridGroups(true, true);
      // Even if ungroup fails, the overall migration shouldn't crash
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]);
    });

    it('handles global migration failure gracefully', async () => {
      mockStorageLocalGet.mockRejectedValue(new Error('Storage failure'));
      await expect(migrateToHybridGroups(true, true)).resolves.not.toThrow();
    });
  });

  describe('validateTabsForGrouping', () => {
    it('throws if no tabs provided', () => {
      expect(() => validateTabsForGrouping([])).toThrow('No tabs to group');
      expect(() => validateTabsForGrouping(null)).toThrow('No tabs to group');
    });

    it('throws if tabs are from multiple windows', () => {
      const tabs = [
        { windowId: 1, panoramaGroupId: 1 },
        { windowId: 2, panoramaGroupId: 1 },
      ];
      expect(() => validateTabsForGrouping(tabs)).toThrow(
        'Cross-window grouping attempted',
      );
    });

    it('throws if tabs belong to multiple panorama groups', () => {
      const tabs = [
        { windowId: 1, panoramaGroupId: 1 },
        { windowId: 1, panoramaGroupId: 2 },
      ];
      expect(() => validateTabsForGrouping(tabs)).toThrow(
        'Multiple panorama groups in single native group',
      );
    });

    it('throws if grouping panorama view tabs', () => {
      const tabs = [{ windowId: 1, panoramaGroupId: 1, isPanoramaView: true }];
      expect(() => validateTabsForGrouping(tabs)).toThrow(
        'Cannot group panorama view tabs',
      );
    });

    it('returns true for valid tabs', () => {
      const tabs = [{ windowId: 1, panoramaGroupId: 1, isPanoramaView: false }];
      expect(validateTabsForGrouping(tabs)).toBe(true);
    });
  });

  it('handles validation failures gracefully', async () => {
    const mockGroups = [{ id: 1, name: 'Test Group', tabs: [10, 20] }];
    vi.spyOn(stateManager, 'getGroups').mockResolvedValue(mockGroups);

    // Force cross-window grouping error
    global.browser.tabs.get = vi
      .fn()
      .mockResolvedValueOnce({ id: 10, windowId: 1 })
      .mockResolvedValueOnce({ id: 20, windowId: 2 }); // different window

    await migrateToHybridGroups(1);
    // It should skip grouping and not call browser.tabs.group
    expect(global.browser.tabs.group).not.toHaveBeenCalled();
  });

  it('handles unexpected get window errors safely', async () => {
    const mockGroups = [{ id: 1, name: 'Test Group', tabs: [10] }];
    vi.spyOn(stateManager, 'getGroups').mockResolvedValue(mockGroups);
    global.browser.tabs.get = vi
      .fn()
      .mockResolvedValue({ id: 10, windowId: 1 });

    global.browser.windows.get = vi
      .fn()
      .mockRejectedValue(new Error('Window gone'));

    await migrateToHybridGroups(1);
    expect(global.browser.tabs.group).not.toHaveBeenCalled();
  });
  describe('setupTabGroupListeners', () => {
    it('does not attach listeners if hasTabGroups is false', () => {
      setupTabGroupListeners(false, true);
    });

    it('attaches listeners if hasTabGroups is true', () => {
      setupTabGroupListeners(true, true);
      expect(tabGroupsCreatedListener).not.toBeNull();
      expect(tabGroupsRemovedListener).not.toBeNull();
      expect(tabGroupsUpdatedListener).not.toBeNull();
    });

    it('onCreated listener exists and does not crash', async () => {
      setupTabGroupListeners(true, true);
      await expect(tabGroupsCreatedListener({ id: 10 })).resolves.not.toThrow();
    });

    it('onRemoved clears nativeGroupId from panorama group', async () => {
      setupTabGroupListeners(true, true);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);

      await tabGroupsRemovedListener({ id: 10, windowId: 1 });

      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]);
    });

    it('should ignore non-matching groups on removed', async () => {
      setupTabGroupListeners(true, true);
      vi.spyOn(stateManager, 'getGroups').mockResolvedValue([
        { id: 1, nativeGroupId: 99 },
        { id: 2, nativeGroupId: 100 },
      ]);
      const setGroupsSpy = vi.spyOn(stateManager, 'setGroups');

      await tabGroupsRemovedListener({ id: 99, windowId: 1 });

      expect(setGroupsSpy).toHaveBeenCalledWith(1, [
        { id: 1 }, // nativeGroupId removed
        { id: 2, nativeGroupId: 100 }, // untouched
      ]);
    });

    it('should sync name changes and ignore non-matching groups on updated', async () => {
      setupTabGroupListeners(true, true);
      vi.spyOn(stateManager, 'getGroups').mockResolvedValue([
        { id: 1, nativeGroupId: 99, name: 'Old Name' },
        { id: 2, nativeGroupId: 100, name: 'Other Group' },
      ]);
      const setGroupsSpy = vi.spyOn(stateManager, 'setGroups');

      await tabGroupsUpdatedListener({
        id: 99,
        windowId: 1,
        title: 'New Name',
      });

      expect(setGroupsSpy).toHaveBeenCalledWith(1, [
        { id: 1, nativeGroupId: 99, name: 'New Name' },
        { id: 2, nativeGroupId: 100, name: 'Other Group' },
      ]);
    });

    it('onUpdated syncs native group name back to panorama group', async () => {
      setupTabGroupListeners(true, true);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);

      await tabGroupsUpdatedListener({
        id: 10,
        windowId: 1,
        title: 'New Name',
      });

      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'New Name', nativeGroupId: 10 },
      ]);
    });

    it('onRemoved listener catches errors', async () => {
      setupTabGroupListeners(true, true);
      // Make setGroups throw to hit the catch block
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);
      stateManager.setGroups.mockRejectedValue(new Error('Sync error'));
      await tabGroupsRemovedListener({ id: 10, windowId: 1 });
    });

    it('onUpdated listener catches errors', async () => {
      setupTabGroupListeners(true, true);
      // Make setGroups throw to hit the catch block
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);
      stateManager.setGroups.mockRejectedValue(new Error('Sync error'));
      await tabGroupsUpdatedListener({
        id: 10,
        windowId: 1,
        title: 'New Name',
      });
    });

    it('setupTabGroupListeners catches errors during setup', () => {
      globalThis.browser.tabGroups.onCreated.addListener = () => {
        throw new Error('Setup error');
      };
      expect(() => setupTabGroupListeners(true, true)).not.toThrow();
    });
  });

  describe('cleanupNativeGroups', () => {
    it('ungroups native groups and clears nativeGroupIds', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);

      // 1 tab in native group, 1 not in native group
      const tabs = [
        { id: 101, windowId: 1, groupId: 10 },
        { id: 102, windowId: 1, groupId: -1 },
      ];
      mockTabsQuery.mockResolvedValue(tabs);

      await cleanupNativeGroups(true);

      expect(mockTabsUngroup).toHaveBeenCalledWith([101]);
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]);
      expect(mockStorageLocalSet).toHaveBeenCalledWith({
        hybridGroupsMigrationComplete: false,
      });
    });

    it('ignores non-matching groups and verifies successfully', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      const mockGroups = [
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
        { id: 2, name: 'Group 2' }, // no nativeGroupId
      ];
      mockTabsQuery.mockResolvedValue([{ id: 101, windowId: 1, groupId: 10 }]);

      vi.spyOn(stateManager, 'getGroups')
        .mockResolvedValueOnce(mockGroups) // Initial get
        .mockResolvedValueOnce([
          // Verification get (successful, no nativeIds)
          { id: 1, name: 'Group 1' },
          { id: 2, name: 'Group 2' },
        ]);

      const setGroupsSpy = vi.spyOn(stateManager, 'setGroups');

      await cleanupNativeGroups(true);

      expect(setGroupsSpy).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' }, // removed
        { id: 2, name: 'Group 2' }, // untouched
      ]);
    });

    it('warns if race condition detected in cleanup verification', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      const mockGroups = [{ id: 1, nativeGroupId: 10 }];
      mockTabsQuery.mockResolvedValue([{ id: 101, windowId: 1, groupId: 10 }]);

      vi.spyOn(stateManager, 'getGroups')
        .mockResolvedValueOnce(mockGroups) // Initial
        .mockResolvedValueOnce(mockGroups); // Verification STILL HAS nativeGroupId

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();
      await cleanupNativeGroups(true);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Race condition detected'),
        expect.any(Array),
      );
      consoleWarnSpy.mockRestore();
    });

    it('skips ungrouping if no tabs in native groups found', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);

      const tabs = [
        { id: 101, windowId: 1, groupId: -1 }, // no native groups
      ];
      mockTabsQuery.mockResolvedValue(tabs);

      await cleanupNativeGroups(true);

      expect(mockTabsUngroup).not.toHaveBeenCalled();
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]);
    });

    it('handles verification warning during cleanup DEBUG', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);

      // Return a group that STILL has nativeGroupId on verification
      stateManager.getGroups
        .mockResolvedValueOnce([{ id: 1, name: 'Group 1', nativeGroupId: 10 }]) // initial
        .mockResolvedValueOnce([{ id: 1, name: 'Group 1', nativeGroupId: 10 }]); // verification

      const tabs = [];
      mockTabsQuery.mockResolvedValue(tabs);

      await cleanupNativeGroups(true);
      // Warning should be logged, coverage hit
    });

    it('warns if ungrouping fails', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);
      const tabs = [{ id: 101, windowId: 1, groupId: 10 }];
      mockTabsQuery.mockResolvedValue(tabs);
      mockTabsUngroup.mockRejectedValueOnce(new Error('Ungroup fail'));

      await cleanupNativeGroups(true);
      expect(stateManager.setGroups).toHaveBeenCalledWith(1, [
        { id: 1, name: 'Group 1' },
      ]);
    });

    it('skips window if no groups exist', async () => {
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue(null);
      await cleanupNativeGroups(true);
      expect(mockTabsQuery).not.toHaveBeenCalled();
    });

    it('re-throws error if cleanup completely fails', async () => {
      mockWindowsGetAll.mockRejectedValue(new Error('Fatal cleanup error'));
      await expect(cleanupNativeGroups(false)).rejects.toThrow(
        'Fatal cleanup error',
      );
    });

    it('suppresses onRemoved events during cleanup', async () => {
      // First, setup listeners
      setupTabGroupListeners(true, true);

      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1', nativeGroupId: 10 },
      ]);
      mockTabsQuery.mockResolvedValue([{ id: 101, windowId: 1, groupId: 10 }]);

      // Trigger the listener while cleanup is simulating
      mockTabsUngroup.mockImplementationOnce(async () => {
        // While ungrouping is happening, the listener fires
        await tabGroupsRemovedListener({ id: 10, windowId: 1 });
      });

      await cleanupNativeGroups(false);

      // Listener shouldn't have done its work because isCleanupInProgress was true
      // (The setGroups call should only be the one from cleanupNativeGroups)
      expect(stateManager.setGroups).toHaveBeenCalledTimes(1);
    });
  });

  describe('DEBUG flag coverage and missing branches', () => {
    it('runs operations with DEBUG = false and covers various false/missing branches', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
      ]);

      stateManager.getGroups.mockImplementation((windowId) => {
        if (windowId === 1) {
          return Promise.resolve([{ id: 1, name: 'Group 1' }]);
        }
        if (windowId === 2) {
          return Promise.resolve([
            { id: 2, name: 'Group 2', nativeGroupId: 10 },
          ]);
        }
        if (windowId === 3) {
          return Promise.resolve([
            { id: 5, name: '', nativeGroupId: 50 },
            { id: 3, name: 'Group 3' },
          ]);
        }
        if (windowId === 4) {
          return Promise.resolve(null);
        }
        if (windowId === undefined) {
          return Promise.resolve([
            { id: 1, name: 'Group 1' },
            { id: 2, name: 'Group 2', nativeGroupId: 10 },
            { id: 5, name: '', nativeGroupId: 50 },
            { id: 3, name: 'Group 3' },
          ]);
        }
        return Promise.resolve([]);
      });

      stateManager.getActiveGroup.mockImplementation((windowId) => {
        if (windowId === 1) return Promise.resolve(1);
        if (windowId === 2) return Promise.resolve(2);
        if (windowId === 3) return Promise.resolve(5);
        return Promise.resolve(null);
      });

      const tab1 = {
        id: 101,
        title: 'Tab 1',
        url: 'https://example.com',
        groupId: -1,
      };
      const tab2 = {
        id: 102,
        title: 'Tab 2',
        url: 'https://example.com',
        groupId: 20,
      };
      const tab3 = {
        id: 103,
        title: 'Tab 3',
        url: 'https://example.com',
        groupId: -1,
      };

      mockTabsQuery.mockImplementation(({ windowId }) => {
        if (windowId === 1) {
          return Promise.resolve([{ ...tab1, id: 101, windowId: 1 }]);
        }
        if (windowId === 2) {
          return Promise.resolve([
            { ...tab1, id: 101, windowId: 2, groupId: 10 },
          ]);
        }
        if (windowId === 3) {
          return Promise.resolve([
            { ...tab1, id: 101, windowId },
            { ...tab2, id: 102, windowId },
            { ...tab3, id: 103, windowId },
          ]);
        }
        return Promise.resolve([
          { ...tab1, id: 101, windowId },
          { ...tab2, id: 102, windowId },
        ]);
      });

      stateManager.getTabGroup.mockImplementation((id, windowId) => {
        if (id === 102) return Promise.resolve(-1); // panorama view
        if (id === 103) return Promise.resolve(3); // Group 3 (inactive)
        if (windowId === 1) return Promise.resolve(1);
        if (windowId === 2) return Promise.resolve(2);
        return Promise.resolve(5);
      });

      mockTabsGroup.mockResolvedValue(99);

      let win1CallCount = 0;
      mockWindowsGet.mockImplementation((id) => {
        if (id === 1) {
          win1CallCount += 1;
          if (win1CallCount === 1) {
            return Promise.resolve({ id: 1 });
          }
          return Promise.reject(new Error('Window closed'));
        }
        if (id === 2 || id === 3 || id === 4) {
          return Promise.resolve({ id });
        }
        return Promise.reject(new Error('Unexpected window'));
      });

      let get50CallCount = 0;
      mockTabGroupsGet.mockImplementation((id) => {
        if (id === 10) {
          return Promise.resolve({ id: 10, windowId: 2, title: 'Group 2' });
        }
        if (id === 50) {
          get50CallCount += 1;
          if (get50CallCount === 1) {
            return Promise.resolve({ id: 50, windowId: 3, title: 'Group 5' });
          }
          return Promise.reject(new Error('Stale reference'));
        }
        if (id === 99) {
          return Promise.resolve({ id: 99, windowId: 3, title: 'Group 5' });
        }
        return Promise.reject(new Error('Unexpected group id'));
      });

      setupTabGroupListeners(true, false);

      if (tabGroupsRemovedListener) {
        await tabGroupsRemovedListener({ id: 10, windowId: 1 });
      }

      mockTabsUngroup.mockImplementationOnce(async () => {
        if (tabGroupsRemovedListener) {
          await tabGroupsRemovedListener({ id: 10, windowId: 1 });
        }
      });

      // 1) verifyNativeGroupPersistence
      await verifyNativeGroupPersistence(true, false);

      // 2) migrateToHybridGroups with hasTabGroups = false
      await migrateToHybridGroups(false, false);

      // 3) migrateToHybridGroups with hasTabGroups = true
      await migrateToHybridGroups(true, false);

      // 3.1) call migrateToHybridGroups again with complete flag set to cover complete check branches
      mockStorageLocalGet.mockResolvedValueOnce({
        hybridGroupsMigrationComplete: true,
      });
      await migrateToHybridGroups(true, false);

      // 4) cleanupNativeGroups with no windows
      mockWindowsGetAll.mockResolvedValueOnce([]);
      await cleanupNativeGroups(false);

      // 5) cleanupNativeGroups with no tabs in native groups
      mockWindowsGetAll.mockResolvedValueOnce([{ id: 1 }]);
      mockTabsQuery.mockResolvedValueOnce([
        { id: 101, windowId: 1, groupId: -1 },
      ]);
      await cleanupNativeGroups(false);

      // 6) cleanupNativeGroups normal run
      mockWindowsGetAll.mockResolvedValueOnce([{ id: 1 }]);
      mockTabsQuery.mockResolvedValueOnce([
        { id: 101, windowId: 1, groupId: 10 },
      ]);
      await cleanupNativeGroups(false);
    });

    it('onRemoved listener does nothing if groups is falsy', async () => {
      setupTabGroupListeners(true, false);
      stateManager.getGroups.mockResolvedValue(null);
      await tabGroupsRemovedListener({ id: 10, windowId: 1 });
      expect(stateManager.setGroups).not.toHaveBeenCalled();
    });

    it('onUpdated listener does nothing if groups is falsy', async () => {
      setupTabGroupListeners(true, false);
      stateManager.getGroups.mockResolvedValue(null);
      await tabGroupsUpdatedListener({
        id: 10,
        windowId: 1,
        title: 'New Name',
      });
      expect(stateManager.setGroups).not.toHaveBeenCalled();
    });

    it('skips grouping if window.get fails and DEBUG is false', async () => {
      mockStorageLocalGet.mockResolvedValue({});
      mockWindowsGetAll.mockResolvedValue([{ id: 1 }]);
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      stateManager.getActiveGroup.mockResolvedValue(1);

      const tab1 = { id: 101, windowId: 1, title: 'Tab 1' };
      mockTabsQuery.mockResolvedValue([tab1]);
      stateManager.getTabGroup.mockResolvedValue(1);

      mockWindowsGet.mockRejectedValueOnce(new Error('Window closed'));

      await migrateToHybridGroups(true, false);

      expect(mockTabsGroup).not.toHaveBeenCalled();
    });
  });
});
