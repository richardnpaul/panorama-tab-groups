import { vi } from 'vitest';

let stateManager;

// Mocks
vi.mock('../../src/js/share/options.js', () => ({
  loadOptions: vi.fn().mockResolvedValue({
    view: 'popup',
    shortcut: {
      'activate-next-group': { disabled: false },
      'activate-previous-group': { disabled: false },
      'manage-extension': { disabled: false },
    },
  }),
}));
vi.mock('../../src/js/background/StateManager.js', () => ({
  stateManager: {
    getGroups: vi.fn().mockResolvedValue([]),
    setGroups: vi.fn().mockResolvedValue(),
    getTabGroup: vi.fn().mockResolvedValue(-2),
    setTabGroup: vi.fn().mockResolvedValue(),
    getGroupIndex: vi.fn().mockResolvedValue(1),
    setGroupIndex: vi.fn().mockResolvedValue(),
    getActiveGroup: vi.fn().mockResolvedValue(1),
    setActiveGroup: vi.fn().mockResolvedValue(),
  },
}));
vi.mock('../../src/js/background/utils.js', () => ({
  mod: vi.fn((n, m) => ((n % m) + m) % m),
  getColorForGroupId: vi.fn().mockReturnValue('blue'),
  getLowestPositiveGroupId: vi.fn().mockReturnValue(1),
}));
vi.mock('../../src/js/background/menu-manager.js', () => ({
  createMenuList: vi.fn().mockResolvedValue(),
  handleMenuChange: vi.fn(),
}));
vi.mock('../../src/js/background/native-groups.js', () => ({
  migrateToHybridGroups: vi.fn().mockResolvedValue(),
  setupTabGroupListeners: vi.fn(),
  cleanupNativeGroups: vi.fn().mockResolvedValue(),
}));

let bgModule;
let actionSetTitleMock;
let actionSetBadgeTextMock;
let actionSetBadgeBackgroundColorMock;
let menuManagerMock;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();

  actionSetTitleMock = vi.fn().mockResolvedValue();
  actionSetBadgeTextMock = vi.fn().mockResolvedValue();
  actionSetBadgeBackgroundColorMock = vi.fn().mockResolvedValue();

  const smModule = await import('../../src/js/background/StateManager.js');
  stateManager = smModule.stateManager;
  // Prevent background init from creating groups and polluting mocks
  stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);

  menuManagerMock = await import('../../src/js/background/menu-manager.js');

  globalThis.browser = globalThis.browser || {};
  Object.assign(globalThis.browser, {
    runtime: {
      getManifest: () => ({ version: '1.0' }),
      getURL: (path) => `moz-extension://ext-id/${path}`,
      onMessage: {
        addListener: vi.fn(),
      },
      onInstalled: {
        addListener: vi.fn(),
      },
      onMessageExternal: {
        addListener: vi.fn(),
      },
      setUninstallURL: vi.fn(),
      sendMessage: vi.fn().mockResolvedValue(),
    },
    action: {
      setPopup: vi.fn(),
      setTitle: actionSetTitleMock,
      setBadgeText: actionSetBadgeTextMock,
      setBadgeBackgroundColor: actionSetBadgeBackgroundColorMock,
      onClicked: {
        addListener: vi.fn(),
      },
    },
    commands: {
      onCommand: {
        addListener: vi.fn(),
      },
    },
    windows: {
      getCurrent: vi.fn().mockResolvedValue({ id: 1 }),
      get: vi.fn().mockResolvedValue({ id: 1, type: 'normal' }),
      getAll: vi.fn().mockResolvedValue([{ id: 1 }]),
      getLastFocused: vi.fn().mockResolvedValue({ id: 1 }),
      onCreated: {
        addListener: vi.fn(),
      },
      onRemoved: {
        addListener: vi.fn(),
      },
    },
    tabs: {
      get: vi.fn().mockResolvedValue({ id: 101, windowId: 1 }),
      create: vi.fn().mockResolvedValue({ id: 100 }),
      query: vi.fn().mockResolvedValue([]),
      hide: vi.fn().mockResolvedValue(),
      show: vi.fn().mockResolvedValue(),
      update: vi.fn().mockResolvedValue(),
      move: vi.fn().mockResolvedValue(),
      group: vi.fn().mockResolvedValue(),
      ungroup: vi.fn().mockResolvedValue(),
      remove: vi.fn().mockResolvedValue(),
      onCreated: {
        addListener: vi.fn(),
      },
      onActivated: {
        addListener: vi.fn(),
      },
      onUpdated: {
        addListener: vi.fn(),
      },
      onRemoved: {
        addListener: vi.fn(),
      },
      onAttached: {
        addListener: vi.fn(),
      },
      onDetached: {
        addListener: vi.fn(),
      },
    },
    tabGroups: {
      get: vi.fn().mockResolvedValue({ id: 101, windowId: 1 }),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue(),
    },
    storage: {
      local: {
        set: vi.fn().mockResolvedValue(),
      },
      onChanged: {
        addListener: vi.fn(),
      },
    },
    sessions: {
      getWindowValue: vi.fn().mockResolvedValue(undefined),
      setWindowValue: vi.fn().mockResolvedValue(),
      getRecentlyClosed: vi.fn().mockResolvedValue([]),
    },
    contextMenus: {
      remove: vi.fn().mockResolvedValue(),
      removeAll: vi.fn().mockResolvedValue(),
      onClicked: {
        addListener: vi.fn(),
      },
    },
    i18n: {
      getMessage: vi.fn((key) => key),
    },
  });
  // Import background.js and let its import-time init() settle so it cannot
  // consume mock values queued by the test
  bgModule = await import('../../src/js/background.js');
  await vi.waitFor(() => {
    expect(bgModule.initializationState.isInitializing).toBe(false);
  });
});

describe('background.js', () => {
  describe('Exported Helpers', () => {
    describe('waitForInitialization', () => {
      beforeEach(() => {
        vi.useFakeTimers({ advanceTimers: true }); // Modern fake timers
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('resolves immediately if not initializing', async () => {
        bgModule.initializationState.isInitializing = false;
        await expect(bgModule.waitForInitialization()).resolves.toBeUndefined();
      });

      it('waits and resolves when initialization finishes', async () => {
        bgModule.initializationState.isInitializing = true;
        const promise = bgModule.waitForInitialization();

        bgModule.initializationState.isInitializing = false;
        vi.advanceTimersByTime(100);

        await expect(promise).resolves.toBeUndefined();
      });

      it('times out after INITIALIZATION_TIMEOUT_MS', async () => {
        bgModule.initializationState.isInitializing = true;
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

        const promise = bgModule.waitForInitialization();
        vi.advanceTimersByTime(15000);

        await expect(promise).resolves.toBeUndefined();
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining('timed out'),
        );
        consoleWarnSpy.mockRestore();
      });
    });

    describe('enrichTabForGrouping', () => {
      it('returns enriched tab object', async () => {
        stateManager.getTabGroup.mockResolvedValue('group1');
        const enriched = await bgModule.enrichTabForGrouping({
          id: 5,
          windowId: 1,
          groupId: -1,
          title: 'Test',
        });

        expect(enriched).toEqual({
          tabId: 5,
          windowId: 1,
          panoramaGroupId: 'group1',
          isPanoramaView: false,
          isUngrouped: false,
          nativeGroupId: null,
          title: 'Test',
        });
      });

      it('identifies panorama view group and ungrouped group', async () => {
        stateManager.getTabGroup.mockResolvedValue(-1); // PANORAMA_VIEW_GROUP_ID
        const enriched1 = await bgModule.enrichTabForGrouping({
          id: 5,
          windowId: 1,
          groupId: -1,
          title: 'Test',
        });
        expect(enriched1.isPanoramaView).toBe(true);

        stateManager.getTabGroup.mockResolvedValue(-2); // UNGROUPED_GROUP_ID
        const enriched2 = await bgModule.enrichTabForGrouping({
          id: 5,
          windowId: 1,
          groupId: -1,
          title: 'Test',
        });
        expect(enriched2.isUngrouped).toBe(true);
      });
    });

    describe('validateAndCheckSafety', () => {
      it('returns unsafe if no tabs to group', async () => {
        const result = await bgModule.validateAndCheckSafety([], 1, 'group1');
        expect(result).toEqual({ safe: false, reason: 'No tabs to group' });
      });

      it('returns unsafe if window does not exist', async () => {
        globalThis.browser.windows.get.mockRejectedValue(
          new Error('No window'),
        );
        const result = await bgModule.validateAndCheckSafety(
          [{ tabId: 5 }],
          99,
          'group1',
        );
        expect(result).toEqual({
          safe: false,
          reason: 'Window 99 no longer exists',
        });
      });

      it('returns unsafe if cross-window contamination', async () => {
        globalThis.browser.windows.get.mockResolvedValue({ id: 1 });
        const tabs = [
          { tabId: 1, windowId: 1 },
          { tabId: 2, windowId: 2 },
        ];
        const result = await bgModule.validateAndCheckSafety(tabs, 1, 'group1');
        expect(result.safe).toBe(false);
        expect(result.reason).toContain('Cross-window: tabs from windows 1, 2');
      });

      it('returns unsafe if mixed panorama groups', async () => {
        globalThis.browser.windows.get.mockResolvedValue({ id: 1 });
        const tabs = [
          { tabId: 1, windowId: 1, panoramaGroupId: 'group1' },
          { tabId: 2, windowId: 1, panoramaGroupId: 'group2' },
        ];
        const result = await bgModule.validateAndCheckSafety(tabs, 1, 'group1');
        expect(result.safe).toBe(false);
        expect(result.reason).toContain(
          'Group mismatch: expected group1, got group1, group2',
        );
      });

      it('returns unsafe if grouping would leave window in bad state (single tab scenario)', async () => {
        globalThis.browser.windows.get.mockResolvedValue({ id: 1 });
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 1, url: 'http://example.com' },
        ]);
        const tabs = [{ tabId: 1, windowId: 1, panoramaGroupId: 'group1' }];
        const result = await bgModule.validateAndCheckSafety(tabs, 1, 'group1');
        expect(result.safe).toBe(false);
        expect(result.reason).toBe(
          'Would group only tab in window (window closure risk)',
        );
      });

      it('returns safe if all checks pass', async () => {
        globalThis.browser.windows.get.mockResolvedValue({ id: 1 });
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 1, url: 'http://example.com' },
          { id: 2, url: 'http://example2.com' },
        ]);
        const tabs = [{ tabId: 1, windowId: 1, panoramaGroupId: 'group1' }];
        const result = await bgModule.validateAndCheckSafety(tabs, 1, 'group1');
        expect(result).toEqual({ safe: true });
      });
    });

    describe('toggleVisibleTabs', () => {
      beforeEach(() => {
        globalThis.browser.windows.getCurrent.mockResolvedValue({ id: 1 });
        stateManager.getGroups.mockResolvedValue([
          { id: 1, nativeGroupId: 101 },
          { id: 2, nativeGroupId: 102 },
        ]);
      });

      it('returns early if activeGroup is undefined', async () => {
        globalThis.browser.tabs.query.mockClear();
        await bgModule.toggleVisibleTabs(undefined);
        expect(globalThis.browser.tabs.query).not.toHaveBeenCalled();
      });

      it('returns early if activeGroup is invalid', async () => {
        globalThis.browser.tabs.query.mockClear();
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation();
        await bgModule.toggleVisibleTabs('invalid');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Invalid activeGroup'),
        );
        expect(globalThis.browser.tabs.query).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
      });

      it('aborts if no tabs will be shown (prevents hiding all)', async () => {
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 1, pinned: false },
        ]);
        stateManager.getTabGroup.mockResolvedValue(1);

        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation();
        await bgModule.toggleVisibleTabs(2); // different group, so tab 1 will be hidden, nothing shown

        expect(consoleErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining('ERROR: No tabs will be shown!'),
        );
        expect(globalThis.browser.tabs.hide).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
      });

      it('hides inactive tabs and shows active tabs', async () => {
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 1, pinned: false, lastAccessed: 100 },
          { id: 2, pinned: false, lastAccessed: 200 },
          { id: 3, pinned: false, lastAccessed: 300 }, // another tab for group 1
          { id: 4, pinned: true }, // pinned tabs skipped
        ]);
        stateManager.getTabGroup.mockImplementation(async (id) =>
          id === 1 || id === 3 ? 1 : 2,
        );
        stateManager.getGroups.mockResolvedValue([
          { id: 1, nativeGroupId: 101 },
          { id: 2, nativeGroupId: 102 },
        ]);

        await bgModule.toggleVisibleTabs(1, true); // noTabSelected = true

        // Tab 1, 3 should be shown, Tab 2 hidden
        expect(globalThis.browser.tabs.hide).toHaveBeenCalledWith([2]);
        expect(globalThis.browser.tabs.show).toHaveBeenCalledWith([1, 3]);

        // noTabSelected -> activates most recently accessed shown tab (id 3 has lastAccessed: 300)
        expect(globalThis.browser.tabs.update).toHaveBeenCalledWith(3, {
          active: true,
        });

        // Native groups management
        expect(globalThis.browser.tabGroups.update).toHaveBeenCalledWith(102, {
          collapsed: true,
        });
        expect(globalThis.browser.tabGroups.update).toHaveBeenCalledWith(101, {
          collapsed: false,
        });
      });

      it('handles panorama view tab (-1) correctly', async () => {
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 1, pinned: false },
        ]);
        stateManager.getTabGroup.mockResolvedValue(-1); // tab is panorama view

        // Active group is panorama view
        await bgModule.toggleVisibleTabs(-1);
        expect(globalThis.browser.tabs.show).toHaveBeenCalledWith([1]);

        vi.clearAllMocks();

        // Active group is some normal group
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 1, pinned: false }, // panorama view
          { id: 2, pinned: false }, // normal tab
        ]);
        stateManager.getTabGroup.mockImplementation(async (id) =>
          id === 1 ? -1 : 1,
        );

        await bgModule.toggleVisibleTabs(1);
        expect(globalThis.browser.tabs.hide).toHaveBeenCalledWith([1]);
        expect(globalThis.browser.tabs.show).toHaveBeenCalledWith([2]);
      });
    });

    describe('setActionTitle', () => {
      beforeEach(() => {
        stateManager.getGroups.mockResolvedValue([
          { id: 1, name: 'Group 1' },
          { id: 2, name: 'Group 2' },
        ]);
        stateManager.getActiveGroup.mockResolvedValue(1);
      });

      it('sets action title and badge text successfully', async () => {
        await bgModule.setActionTitle(1);

        expect(actionSetTitleMock).toHaveBeenCalledWith({
          title: 'Active Group: Group 1',
          windowId: 1,
        });
        expect(actionSetBadgeTextMock).toHaveBeenCalledWith({
          text: '2',
          windowId: 1,
        });
        expect(actionSetBadgeBackgroundColorMock).toHaveBeenCalledWith({
          color: '#666666',
        });
      });

      it('logs warning if setting action fails', async () => {
        actionSetTitleMock.mockRejectedValue(new Error('API Error'));
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

        await bgModule.setActionTitle(1);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Failed to set action title/badge:',
          expect.any(Error),
        );
        consoleWarnSpy.mockRestore();
      });
    });

    describe('moveTab', () => {
      beforeEach(() => {
        globalThis.browser.windows.getCurrent.mockResolvedValue({ id: 1 });
        stateManager.getActiveGroup.mockResolvedValue(1);
        globalThis.browser.tabs.query.mockResolvedValue([]);
      });

      it('ungroups tab if target group has native group but is NOT active', async () => {
        stateManager.getGroups.mockResolvedValue([
          { id: 2, nativeGroupId: 102 },
        ]);
        stateManager.getActiveGroup.mockResolvedValue(1); // Not active
        await bgModule.moveTab(10, 2);

        expect(globalThis.browser.tabs.ungroup).toHaveBeenCalledWith([10]);
      });

      it('groups tab if target group has native group and IS active', async () => {
        stateManager.getGroups.mockResolvedValue([
          { id: 2, nativeGroupId: 102 },
        ]);
        stateManager.getActiveGroup.mockResolvedValue(2); // Active
        await bgModule.moveTab(10, 2);

        expect(globalThis.browser.tabs.group).toHaveBeenCalledWith({
          tabIds: [10],
          groupId: 102,
        });
      });

      it('logs warning if native grouping fails', async () => {
        stateManager.getGroups.mockResolvedValue([
          { id: 2, nativeGroupId: 102 },
        ]);
        stateManager.getActiveGroup.mockResolvedValue(2); // Active
        globalThis.browser.tabs.group.mockRejectedValueOnce(
          new Error('Group error'),
        );
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

        await bgModule.moveTab(10, 2);

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Could not assign tab to native group:',
          expect.any(Error),
        );
        consoleWarnSpy.mockRestore();
      });
    });

    describe('menuClicked', () => {
      beforeEach(() => {
        globalThis.browser.windows.getCurrent.mockResolvedValue({ id: 1 });
        stateManager.getActiveGroup.mockResolvedValue(1);
        globalThis.browser.tabs.query.mockResolvedValue([]);
        // Mock moveTab indirectly since it's in the same module
        // We can just verify stateManager.setTabGroup is called for moveTab
      });

      it('handles refresh-groups', async () => {
        await bgModule.menuClicked({ menuItemId: 'refresh-groups' }, {});
        expect(globalThis.browser.contextMenus.removeAll).toHaveBeenCalled();
        expect(menuManagerMock.createMenuList).toHaveBeenCalled();
      });

      it('moves multiple highlighted tabs except active tab', async () => {
        globalThis.browser.tabs.query.mockImplementation(async (query) => {
          if (query.highlighted) return [{ id: 10 }, { id: 11 }];
          if (query.active) return [{ id: 10 }];
          return [];
        });

        await bgModule.menuClicked({ menuItemId: 2 }, { id: 10 });

        // Tab 10 is active, so it's skipped. Tab 11 is moved.
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(11, 2);
        expect(stateManager.setTabGroup).not.toHaveBeenCalledWith(10, 2);
      });

      it('moves single tab and activates neighbor if it is active tab', async () => {
        globalThis.browser.tabs.query.mockImplementation(async (query) => {
          if (query.highlighted) return [{ id: 10 }];
          if (query.active) return [{ id: 10 }];
          if (query.hidden === false)
            return [{ id: 9 }, { id: 10 }, { id: 11 }];
          return [];
        });

        await bgModule.menuClicked({ menuItemId: 2 }, { id: 10 });

        // Tab 10 is moved
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 2);
        // Neighbor (tab 9) is activated
        expect(globalThis.browser.tabs.update).toHaveBeenCalledWith(9, {
          active: true,
        });
      });

      it('activates next neighbor if previous does not exist', async () => {
        globalThis.browser.tabs.query.mockImplementation(async (query) => {
          if (query.highlighted) return [{ id: 10 }];
          if (query.active) return [{ id: 10 }];
          if (query.hidden === false) return [{ id: 10 }, { id: 11 }];
          return [];
        });

        await bgModule.menuClicked({ menuItemId: 2 }, { id: 10 });

        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 2);
        // Next neighbor (tab 11) is activated
        expect(globalThis.browser.tabs.update).toHaveBeenCalledWith(11, {
          active: true,
        });
      });

      it('moves single tab without changing active if not active', async () => {
        globalThis.browser.tabs.query.mockImplementation(async (query) => {
          if (query.highlighted) return [{ id: 10 }]; // only tab 10
          if (query.active) return [{ id: 99 }]; // active is 99
          return [];
        });

        await bgModule.menuClicked({ menuItemId: 2 }, { id: 10 });

        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 2);
        expect(globalThis.browser.tabs.update).not.toHaveBeenCalled();
      });
    });

    describe('tabCreated', () => {
      beforeEach(() => {
        bgModule.backgroundState.openingBackup = false;
        bgModule.backgroundState.openingView = null;
        bgModule.initializationState.isInitializing = false;
      });

      it('returns early if openingBackup is true', async () => {
        bgModule.backgroundState.openingBackup = true;
        await bgModule.tabCreated({ id: 10, windowId: 1 });
        expect(stateManager.setTabGroup).not.toHaveBeenCalled();
      });

      it('assigns panorama view group (-1) if tab is view tab by URL', async () => {
        globalThis.browser.runtime.getURL = vi
          .fn()
          .mockReturnValue('moz-extension://ext-id/view.html');
        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'moz-extension://ext-id/view.html',
        });

        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, -1);
      });

      it('assigns panorama view group (-1) if tab is view tab by openingView state', async () => {
        bgModule.backgroundState.openingView = { tabId: 10, timeout: 123 };
        globalThis.browser.runtime.getURL = vi
          .fn()
          .mockReturnValue('moz-extension://ext-id/view.html');

        const clearTimeoutSpy = vi
          .spyOn(globalThis, 'clearTimeout')
          .mockImplementation();
        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'http://example.com',
        });

        expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
        expect(bgModule.backgroundState.openingView).toBeNull();
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, -1);
        clearTimeoutSpy.mockRestore();
      });

      it('assigns tab to active group and creates native group if missing', async () => {
        globalThis.browser.runtime.getURL = vi
          .fn()
          .mockReturnValue('moz-extension://ext-id/view.html');

        // Mock stateManager to return undefined first, then 2 after it's assigned
        let tab10Group;
        stateManager.setTabGroup.mockImplementation(async (id, group) => {
          if (id === 10) tab10Group = group;
        });
        stateManager.getTabGroup.mockImplementation(async (id) =>
          id === 10 ? tab10Group : undefined,
        );
        stateManager.getActiveGroup.mockResolvedValue(2); // Active group is 2

        // Mock current groups where group 2 exists but has no nativeGroupId
        stateManager.getGroups.mockResolvedValue([{ id: 2, name: 'Group 2' }]);

        // Mock tabs in window (need >1 to pass window closure risk check)
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 10, windowId: 1, url: 'http://example.com' },
          { id: 11, windowId: 1, url: 'http://example2.com' },
        ]);

        // Mock browser.tabs.group
        globalThis.browser.tabs.group.mockResolvedValue(102); // Created native group id 102

        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'http://example.com',
          active: true,
        });

        // Tab assigned to active group
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 2);

        // Native group created
        expect(globalThis.browser.tabs.group).toHaveBeenCalledWith({
          tabIds: [10],
        });
        expect(globalThis.browser.tabGroups.update).toHaveBeenCalledWith(102, {
          title: 'Group 2',
          color: expect.any(String),
        });

        // Native group id saved
        expect(stateManager.setGroups).toHaveBeenCalled();
      });

      it('assigns tab to existing native group if target group is active', async () => {
        stateManager.getTabGroup.mockResolvedValue(undefined);
        stateManager.getActiveGroup.mockResolvedValue(2);

        // Mock current groups where group 2 HAS a nativeGroupId
        stateManager.getGroups.mockResolvedValue([
          { id: 2, nativeGroupId: 102 },
        ]);

        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'http://example.com',
          active: true,
        });

        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 2);
        expect(globalThis.browser.tabs.group).toHaveBeenCalledWith({
          tabIds: [10],
          groupId: 102,
        });
      });

      it('logs warning if native group assignment fails', async () => {
        stateManager.getTabGroup.mockResolvedValue(undefined);
        stateManager.getActiveGroup.mockResolvedValue(2);
        stateManager.getGroups.mockResolvedValue([
          { id: 2, nativeGroupId: 102 },
        ]);
        globalThis.browser.tabs.group.mockRejectedValueOnce(
          new Error('Group error'),
        );
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'http://example.com',
          active: true,
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'Could not assign new tab to native group:',
          expect.any(Error),
        );
        consoleWarnSpy.mockRestore();
      });

      it('defaults activeGroup to lowest positive group ID if undefined', async () => {
        stateManager.getTabGroup.mockResolvedValue(undefined);
        stateManager.getActiveGroup.mockResolvedValue(undefined); // No active group

        stateManager.getGroups.mockResolvedValue([{ id: 1 }, { id: 3 }]);

        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'http://example.com',
        });

        // Lowest positive group ID should be 1
        expect(stateManager.setActiveGroup).toHaveBeenCalledWith(1, 1);
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 1);
      });

      it('defaults activeGroup to 0 if no positive groups exist', async () => {
        stateManager.getTabGroup.mockResolvedValue(undefined);
        stateManager.getActiveGroup.mockResolvedValue(undefined); // No active group

        stateManager.getGroups.mockResolvedValue([]); // No groups
        const { getLowestPositiveGroupId } =
          await import('../../src/js/background/utils.js');
        getLowestPositiveGroupId.mockReturnValueOnce(undefined);

        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'http://example.com',
        });

        // 0 is the fallback
        expect(stateManager.setActiveGroup).toHaveBeenCalledWith(1, 0);
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 0);
      });

      it('skips native group creation if safety check fails', async () => {
        globalThis.browser.windows.get.mockRejectedValue(
          new Error('No window'),
        );
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 10, windowId: 1, active: true },
        ]);
        stateManager.getTabGroup.mockResolvedValue(1);
        stateManager.getActiveGroup.mockResolvedValue(1);
        stateManager.getGroups.mockResolvedValue([
          { id: 1, nativeGroupId: null },
        ]);

        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'http://example.com',
        });

        // The group is NOT created because safety check fails
        expect(globalThis.browser.tabs.group).not.toHaveBeenCalled();
      });

      it('aborts native group creation if window is closed during process', async () => {
        globalThis.browser.windows.get
          .mockResolvedValueOnce({ id: 1 })
          .mockRejectedValueOnce(new Error('Window closed'));
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 10, windowId: 1, active: true },
          { id: 11, windowId: 1, active: false },
        ]);
        stateManager.getTabGroup.mockResolvedValue(1);
        stateManager.getActiveGroup.mockResolvedValue(1);
        stateManager.getGroups.mockResolvedValue([
          { id: 1, nativeGroupId: null, title: 'Group 1', color: 'blue' },
        ]);
        const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

        await bgModule.tabCreated({
          id: 10,
          windowId: 1,
          url: 'http://example.com',
        });

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          expect.stringContaining(
            'Window 1 was closed before creating native group',
          ),
        );
        expect(globalThis.browser.tabs.group).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
      });
    });

    describe('tabActivated', () => {
      beforeEach(() => {
        bgModule.initializationState.isInitializing = false;
        globalThis.browser.tabs.get.mockResolvedValue({
          id: 10,
          windowId: 1,
          pinned: false,
        });
      });

      it('returns early if tab is pinned', async () => {
        globalThis.browser.tabs.get.mockResolvedValue({
          id: 10,
          windowId: 1,
          pinned: true,
        });
        await bgModule.tabActivated({ tabId: 10 });
        expect(stateManager.getTabGroup).not.toHaveBeenCalled();
      });

      it('returns early if activeGroup is undefined', async () => {
        stateManager.getTabGroup.mockResolvedValue(undefined);
        await bgModule.tabActivated({ tabId: 10 });
        expect(stateManager.setActiveGroup).not.toHaveBeenCalled();
      });

      it('skips native group creation if activeGroup is panorama view (-1)', async () => {
        stateManager.getTabGroup.mockResolvedValue(-1);
        await bgModule.tabActivated({ tabId: 10 });

        expect(stateManager.setActiveGroup).not.toHaveBeenCalled();
        expect(globalThis.browser.tabGroups.query).not.toHaveBeenCalled();
      });

      it('sets active group and creates native group if missing', async () => {
        stateManager.getTabGroup.mockResolvedValue(2);
        stateManager.getGroups.mockResolvedValue([{ id: 2, name: 'Group 2' }]); // No nativeGroupId
        globalThis.browser.tabGroups.query.mockResolvedValue([]); // No native groups in window

        // Mock tabs in window (need >1 to pass window closure risk check)
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 10, windowId: 1, url: 'http://example.com' },
          { id: 11, windowId: 1, url: 'http://example2.com' },
        ]);

        globalThis.browser.tabs.group.mockResolvedValue(102); // Created native group id 102

        await bgModule.tabActivated({ tabId: 10, windowId: 1 });

        expect(stateManager.setActiveGroup).toHaveBeenCalledWith(1, 2);
        expect(globalThis.browser.tabs.group).toHaveBeenCalledWith({
          tabIds: [10, 11],
        });
        expect(globalThis.browser.tabGroups.update).toHaveBeenCalledWith(102, {
          title: 'Group 2',
          color: expect.any(String),
        });
        expect(stateManager.setGroups).toHaveBeenCalled();
      });

      it('links existing native group if tab is already in one', async () => {
        stateManager.getTabGroup.mockResolvedValue(2);
        stateManager.getGroups.mockResolvedValue([{ id: 2, name: 'Group 2' }]); // No nativeGroupId

        // Mock existing native group in window
        globalThis.browser.tabGroups.query.mockResolvedValue([{ id: 102 }]);
        // Mock tabs.query to return tab 10 in native group 102
        globalThis.browser.tabs.query.mockImplementation(async (query) => {
          if (query.groupId === 102) return [{ id: 10 }];
          return [];
        });

        await bgModule.tabActivated({ tabId: 10, windowId: 1 });

        // Native group should not be created, but linked
        expect(globalThis.browser.tabs.group).not.toHaveBeenCalled();
        expect(stateManager.setGroups).toHaveBeenCalled(); // Saves nativeGroupId
      });
    });

    describe('tabAttached', () => {
      beforeEach(() => {
        bgModule.initializationState.isInitializing = false;
        stateManager.getActiveGroup.mockResolvedValue(2);
        globalThis.browser.tabs.get.mockResolvedValue({
          id: 10,
          windowId: 2,
          url: 'http://example.com',
        });
      });

      it('assigns tab to active group of new window and calls tabCreated', async () => {
        stateManager.getTabGroup.mockResolvedValue(2);

        await bgModule.tabAttached(10, { newWindowId: 2 });

        expect(stateManager.getActiveGroup).toHaveBeenCalledWith(2);
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 2);
        expect(globalThis.browser.tabs.get).toHaveBeenCalledWith(10);
      });
    });

    describe('tabDetached', () => {
      it('removes groupId from tab sessions', async () => {
        globalThis.browser.sessions = {
          removeTabValue: vi.fn().mockResolvedValue(),
        };

        await bgModule.tabDetached(10);

        expect(globalThis.browser.sessions.removeTabValue).toHaveBeenCalledWith(
          10,
          'groupId',
        );
      });
    });
  });

  describe('runtime.onMessage', () => {
    let handleInternalMessage;

    beforeEach(() => {
      // Find the listener for internal messages (usually the first one added)
      [[handleInternalMessage]] =
        globalThis.browser.runtime.onMessage.addListener.mock.calls;
    });

    it('handles createMenuItem, removeMenuItem, updateMenuItem', () => {
      const sendResponse = vi.fn();

      let res = handleInternalMessage(
        { action: 'createMenuItem' },
        {},
        sendResponse,
      );
      expect(res).toBe(false);

      res = handleInternalMessage(
        { action: 'removeMenuItem' },
        {},
        sendResponse,
      );
      expect(res).toBe(false);

      res = handleInternalMessage(
        { action: 'updateMenuItem' },
        {},
        sendResponse,
      );
      expect(res).toBe(false);
    });

    it('handles cleanupNativeGroups', async () => {
      const sendResponse = vi.fn();
      const res = handleInternalMessage(
        { action: 'cleanupNativeGroups' },
        {},
        sendResponse,
      );
      expect(res).toBe(true); // Keeps channel open
    });

    it('handles migrateToHybridGroups', async () => {
      const sendResponse = vi.fn();
      const res = handleInternalMessage(
        { action: 'migrateToHybridGroups' },
        {},
        sendResponse,
      );
      expect(res).toBe(true);
    });

    it('handles deleteGroup successfully', async () => {
      const sendResponse = vi.fn();

      stateManager.getGroups.mockResolvedValue([
        { id: 1, nativeGroupId: 101 },
        { id: 2 },
      ]);
      globalThis.browser.tabs.query.mockImplementation(async (query) => {
        if (query.windowId === 1) return [{ id: 10, groupId: 101 }];
        return [];
      });
      globalThis.browser.tabs.ungroup.mockResolvedValue();
      globalThis.browser.tabs.remove.mockResolvedValue();
      stateManager.setGroups.mockResolvedValue();

      const res = handleInternalMessage(
        {
          action: 'deleteGroup',
          groupId: 1,
          windowId: 1,
          nativeGroupId: 101,
          tabIds: [10],
        },
        {},
        sendResponse,
      );
      expect(res).toBe(true);

      // Flush promises
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(globalThis.browser.tabs.remove).toHaveBeenCalledWith(10);
      expect(stateManager.setGroups).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('handles deleteGroup when last group is deleted', async () => {
      const sendResponse = vi.fn();

      stateManager.getGroups.mockResolvedValue([{ id: 1, nativeGroupId: 101 }]);
      globalThis.browser.tabs.query.mockResolvedValue([]);

      const res = handleInternalMessage(
        {
          action: 'deleteGroup',
          groupId: 1,
          windowId: 1,
          nativeGroupId: 101,
          tabIds: [],
        },
        {},
        sendResponse,
      );
      expect(res).toBe(true);

      await new Promise(process.nextTick);
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(stateManager.setGroups).toHaveBeenCalled(); // Should create a new group
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('handles setBackgroundState', () => {
      const msg = {
        action: 'setBackgroundState',
        key: 'openingBackup',
        value: true,
      };
      const res = handleInternalMessage(msg, {}, vi.fn());

      expect(res).toBe(false);
      expect(bgModule.backgroundState.openingBackup).toBe(true);
    });

    it('handles refreshView actions', () => {
      const sendResponse = vi.fn();

      let res = handleInternalMessage(
        { action: 'refreshView' },
        {},
        sendResponse,
      );
      expect(res).toBe(false);

      res = handleInternalMessage(
        { action: 'checkViewRefresh' },
        {},
        sendResponse,
      );
      expect(res).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({
        viewRefreshOrdered: expect.any(Boolean),
      });

      res = handleInternalMessage(
        { action: 'clearViewRefresh' },
        {},
        sendResponse,
      );
      expect(res).toBe(false);
    });

    it('handles resetMigration', () => {
      const sendResponse = vi.fn();
      globalThis.browser.storage.local.set.mockResolvedValue();

      const res = handleInternalMessage(
        { action: 'resetMigration' },
        {},
        sendResponse,
      );
      expect(res).toBe(true);
    });

    it('handles unknown actions', () => {
      const sendResponse = vi.fn();
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation();

      const res = handleInternalMessage(
        { action: 'unknownAction' },
        {},
        sendResponse,
      );

      expect(res).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Unknown action: unknownAction',
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('runtime.onMessageExternal', () => {
    let handleMessage;

    beforeEach(() => {
      [[handleMessage]] =
        globalThis.browser.runtime.onMessageExternal.addListener.mock.calls;
    });

    it('handles unknown external messages', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation();
      const res = handleMessage('unknown');
      expect(res).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Unknown external message:',
        'unknown',
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('runtime.onInstalled', () => {
    let handleInstalled;

    beforeEach(() => {
      [[handleInstalled]] =
        globalThis.browser.runtime.onInstalled.addListener.mock.calls;
    });

    it('opens release notes on update', () => {
      handleInstalled({ reason: 'update' });
      expect(globalThis.browser.tabs.create).toHaveBeenCalledWith({
        url: expect.stringContaining('releases/tag/'),
      });
    });

    it('does nothing if temporary install', () => {
      globalThis.browser.tabs.create.mockClear();
      handleInstalled({ reason: 'update', temporary: true });
      expect(globalThis.browser.tabs.create).not.toHaveBeenCalled();
    });
  });

  describe('tabs.onUpdated', () => {
    let handleUpdated;

    beforeEach(() => {
      [[handleUpdated]] =
        globalThis.browser.tabs.onUpdated.addListener.mock.calls;
    });

    it('changes tab group to -1 if navigating to panorama view', async () => {
      stateManager.getTabGroup.mockResolvedValue(1);
      await handleUpdated(
        101,
        { url: 'moz-extension://ext-id/view.html' },
        { windowId: 1 },
      );
      expect(stateManager.setTabGroup).toHaveBeenCalledWith(101, -1);
    });

    it('ignores navigation if not panorama view', async () => {
      stateManager.setTabGroup.mockClear();
      await handleUpdated(
        101,
        { url: 'https://example.com' },
        { windowId: 1, url: 'https://example.com' },
      );
      expect(stateManager.setTabGroup).not.toHaveBeenCalled();
    });
  });

  describe('tabs.onCreated', () => {
    let handleCreated;
    beforeEach(() => {
      [[handleCreated]] =
        globalThis.browser.tabs.onCreated.addListener.mock.calls;
    });

    it('handles tab created event (calls tabCreated)', async () => {
      await expect(
        handleCreated({ id: 101, windowId: 1 }),
      ).resolves.not.toThrow();
    });
  });

  describe('tabs.onActivated', () => {
    let handleActivated;
    beforeEach(() => {
      [[handleActivated]] =
        globalThis.browser.tabs.onActivated.addListener.mock.calls;
    });

    it('handles tab activated event', async () => {
      globalThis.browser.windows.get = vi
        .fn()
        .mockResolvedValue({ id: 1, type: 'normal' });
      globalThis.browser.tabs.query.mockResolvedValue([
        { id: 101, windowId: 1, active: true },
      ]);
      await expect(
        handleActivated({ tabId: 101, windowId: 1 }),
      ).resolves.not.toThrow();
    });
  });

  describe('tabs.onRemoved', () => {
    let handleRemoved;
    beforeEach(() => {
      [[handleRemoved]] =
        globalThis.browser.tabs.onRemoved.addListener.mock.calls;
    });

    it('clears openingView state if tab matches', async () => {
      bgModule.backgroundState.openingView = { tabId: 101, timeout: 123 };
      const clearTimeoutSpy = vi
        .spyOn(globalThis, 'clearTimeout')
        .mockImplementation();

      await handleRemoved(101, { windowId: 1 });

      expect(clearTimeoutSpy).toHaveBeenCalledWith(123);
      expect(bgModule.backgroundState.openingView).toBeNull();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('storage.onChanged', () => {
    let handleStorageChanged;
    beforeEach(() => {
      [[handleStorageChanged]] =
        globalThis.browser.storage.onChanged.addListener.mock.calls;
    });

    it('triggers cleanup when useNativeGroups is disabled', async () => {
      await expect(
        handleStorageChanged(
          { useNativeGroups: { oldValue: true, newValue: false } },
          'sync',
        ),
      ).resolves.not.toThrow();
    });

    it('does nothing when useNativeGroups is not disabled', async () => {
      await expect(
        handleStorageChanged(
          { useNativeGroups: { oldValue: false, newValue: true } },
          'sync',
        ),
      ).resolves.not.toThrow();
    });
  });

  describe('windows.onRemoved', () => {
    let handleRemoved;
    beforeEach(() => {
      [[handleRemoved]] =
        globalThis.browser.windows.onRemoved.addListener.mock.calls;
    });

    it('cleans up window state', () => {
      expect(() => handleRemoved(1)).not.toThrow();
    });
  });

  describe('action.onClicked', () => {
    let handleActionClicked;
    beforeEach(() => {
      vi.useFakeTimers();
      [[handleActionClicked]] =
        globalThis.browser.action.onClicked.addListener.mock.calls;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('toggles view: creates new tab if none exists', async () => {
      globalThis.browser.windows.getCurrent = vi
        .fn()
        .mockResolvedValue({ id: 1 });
      globalThis.browser.tabs.query.mockResolvedValue([]); // No ext tabs

      await handleActionClicked();

      expect(globalThis.browser.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('view.html'),
          active: true,
        }),
      );
    });

    it('toggles view: switches to view if exists and not active', async () => {
      globalThis.browser.windows.getCurrent = vi
        .fn()
        .mockResolvedValue({ id: 1 });
      globalThis.browser.tabs.query
        .mockResolvedValueOnce([{ id: 101 }]) // extTabs
        .mockResolvedValueOnce([{ id: 102 }]); // currentTab

      globalThis.browser.tabs.update = vi.fn().mockResolvedValue();

      await handleActionClicked();

      expect(globalThis.browser.tabs.update).toHaveBeenCalledWith(101, {
        active: true,
      });
      vi.runAllTimers(); // clear any hanging timeouts
    });

    it('toggles view: switches to last accessed tab if view is active', async () => {
      globalThis.browser.windows.getCurrent = vi
        .fn()
        .mockResolvedValue({ id: 1 });
      globalThis.browser.tabs.query
        .mockResolvedValueOnce([{ id: 101, windowId: 1 }]) // extTabs
        .mockResolvedValueOnce([{ id: 101, windowId: 1 }]) // currentTab (is view tab)
        .mockResolvedValueOnce([
          // all tabs in window
          { id: 101, lastAccessed: 300 }, // view tab (currently active)
          { id: 102, lastAccessed: 200 }, // Most recently accessed non-view tab
          { id: 103, lastAccessed: 150 },
        ]);

      globalThis.browser.tabs.update = vi.fn().mockResolvedValue();

      await handleActionClicked();

      expect(globalThis.browser.tabs.update).toHaveBeenCalledWith(102, {
        active: true,
      });
    });

    it('toggles view: clears existing openingView timeout when creating new tab', async () => {
      globalThis.browser.windows.getCurrent = vi
        .fn()
        .mockResolvedValue({ id: 1 });
      globalThis.browser.tabs.query.mockResolvedValue([]); // No ext tabs

      const existingTimeout = setTimeout(() => {}, 1000);
      bgModule.backgroundState.openingView = { timeout: existingTimeout };
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      await handleActionClicked();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(existingTimeout);
      expect(globalThis.browser.tabs.create).toHaveBeenCalled();

      clearTimeoutSpy.mockRestore();
    });

    it('toggles view: handles opening timeout expiration', async () => {
      globalThis.browser.windows.getCurrent = vi
        .fn()
        .mockResolvedValue({ id: 1 });
      globalThis.browser.tabs.query.mockResolvedValue([]); // No ext tabs

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation();

      await handleActionClicked();

      expect(bgModule.backgroundState.openingView).not.toBeNull();

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'View tab creation timed out, clearing state',
      );
      expect(bgModule.backgroundState.openingView).toBeNull();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('commands.onCommand', () => {
    let handleCommand;
    beforeEach(() => {
      [[handleCommand]] =
        globalThis.browser.commands.onCommand.addListener.mock.calls;
    });

    it('triggers activate-next-group', async () => {
      globalThis.browser.windows.getCurrent = vi
        .fn()
        .mockResolvedValue({ id: 1, type: 'normal' });
      globalThis.browser.tabs.query.mockResolvedValue([
        { id: 101, windowId: 1, active: false },
      ]);
      stateManager.getTabGroup.mockResolvedValue(2); // Mock the tab belongs to the NEXT group (2)
      stateManager.getActiveGroup.mockResolvedValue(1);
      stateManager.getGroups.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      await handleCommand('activate-next-group');

      expect(stateManager.getActiveGroup).toHaveBeenCalled();
    });

    it('triggers activate-previous-group', async () => {
      globalThis.browser.windows.getCurrent = vi
        .fn()
        .mockResolvedValue({ id: 1, type: 'normal' });
      globalThis.browser.tabs.query.mockResolvedValue([
        { id: 101, windowId: 1, active: false },
      ]);
      stateManager.getTabGroup.mockResolvedValue(1); // Mock tab belongs to the previous group (1)
      stateManager.getActiveGroup.mockResolvedValue(2);
      stateManager.getGroups.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      await handleCommand('activate-previous-group');

      expect(stateManager.getActiveGroup).toHaveBeenCalled();
    });

    it('triggers manage-extension', async () => {
      globalThis.browser.runtime.openOptionsPage = vi.fn();
      await handleCommand('manage-extension');
      expect(globalThis.browser.runtime.openOptionsPage).toHaveBeenCalled();
    });

    it('does not trigger if command is disabled', async () => {
      const { loadOptions } = await import('../../src/js/share/options.js');
      loadOptions.mockResolvedValueOnce({
        shortcut: {
          'activate-next-group': { disabled: true },
        },
      });
      stateManager.getActiveGroup.mockClear();

      await handleCommand('activate-next-group');

      expect(stateManager.getActiveGroup).not.toHaveBeenCalled();
    });
  });

  describe('windows.onCreated', () => {
    let handleCreated;
    beforeEach(() => {
      [[handleCreated]] =
        globalThis.browser.windows.onCreated.addListener.mock.calls;
    });

    it('creates group in window if missing', async () => {
      bgModule.initializationState.isInitializing = false;
      stateManager.getGroups.mockResolvedValue([]); // No groups

      await handleCreated({ id: 1 });

      expect(stateManager.setGroups).toHaveBeenCalled();
    });
  });

  describe('Browser Mode Detection', () => {
    it('detects collapse-only mode when tabGroups is available but tabHide is not', async () => {
      vi.resetModules();
      globalThis.browser.tabs.hide = undefined;
      globalThis.browser.tabGroups = { query: vi.fn().mockResolvedValue([]) };
      globalThis.browser.tabs.group = vi.fn().mockResolvedValue(1);

      await import('../../src/js/background.js');
    });

    it('detects legacy mode when tabHide is available but tabGroups is not', async () => {
      vi.resetModules();
      globalThis.browser.tabs.hide = vi.fn().mockResolvedValue();
      globalThis.browser.tabGroups = undefined;

      await import('../../src/js/background.js');
    });

    it('detects unsupported mode when neither is available', async () => {
      vi.resetModules();
      globalThis.browser.tabs.hide = undefined;
      globalThis.browser.tabGroups = undefined;

      const bg = await import('../../src/js/background.js');
      expect(await bg.shouldUseNativeGroups()).toBe(false);
    });
  });

  describe('Initialization Internal Functions', () => {
    beforeEach(() => {
      globalThis.browser.notifications = {
        create: vi.fn(),
        clear: vi.fn(),
      };
      globalThis.browser.action = {
        ...globalThis.browser.action,
        setBadgeText: vi.fn(),
        setBadgeBackgroundColor: vi.fn(),
      };
      globalThis.browser.runtime = {
        ...globalThis.browser.runtime,
        sendMessage: vi.fn().mockResolvedValue(),
      };
      bgModule.initializationState.showingUI = false;
    });

    describe('UI functions', () => {
      it('showInitializationUI shows UI and sends message', async () => {
        await bgModule.showInitializationUI();

        expect(bgModule.initializationState.showingUI).toBe(true);
        expect(globalThis.browser.notifications.create).toHaveBeenCalledWith(
          'panorama-initializing',
          expect.any(Object),
        );
        expect(globalThis.browser.action.setBadgeText).toHaveBeenCalledWith({
          text: '...',
        });
        expect(globalThis.browser.runtime.sendMessage).toHaveBeenCalledWith({
          action: 'showInitializationLoading',
        });
      });

      it('showInitializationUI returns early if already showing', async () => {
        bgModule.initializationState.showingUI = true;
        await bgModule.showInitializationUI();

        expect(globalThis.browser.notifications.create).not.toHaveBeenCalled();
      });

      it('hideInitializationUI hides UI and sends message', async () => {
        bgModule.initializationState.showingUI = true;
        await bgModule.hideInitializationUI();

        expect(bgModule.initializationState.showingUI).toBe(false);
        expect(globalThis.browser.notifications.clear).toHaveBeenCalledWith(
          'panorama-initializing',
        );
        expect(globalThis.browser.action.setBadgeText).toHaveBeenCalledWith({
          text: '',
        });
        expect(globalThis.browser.runtime.sendMessage).toHaveBeenCalledWith({
          action: 'hideInitializationLoading',
        });
      });

      it('hideInitializationUI returns early if not showing', async () => {
        bgModule.initializationState.showingUI = false;
        await bgModule.hideInitializationUI();

        expect(globalThis.browser.notifications.clear).not.toHaveBeenCalled();
      });

      it('UI functions catch runtime.sendMessage errors gracefully', async () => {
        globalThis.browser.runtime.sendMessage.mockRejectedValueOnce(
          new Error('no receiver'),
        );
        await bgModule.showInitializationUI(); // Should not throw

        globalThis.browser.runtime.sendMessage.mockRejectedValueOnce(
          new Error('no receiver'),
        );
        await bgModule.hideInitializationUI(); // Should not throw
      });
    });

    describe('recoverGroupFromSessionHistory', () => {
      it('returns stored group id', async () => {
        stateManager.getTabGroup.mockResolvedValueOnce(5);
        const result = await bgModule.recoverGroupFromSessionHistory({
          id: 10,
        });
        expect(result).toBe(5);
      });

      it('returns null if stored group id is null, undefined, or NaN', async () => {
        stateManager.getTabGroup.mockResolvedValueOnce(null);
        expect(await bgModule.recoverGroupFromSessionHistory({ id: 10 })).toBe(
          null,
        );

        stateManager.getTabGroup.mockResolvedValueOnce(undefined);
        expect(await bgModule.recoverGroupFromSessionHistory({ id: 10 })).toBe(
          null,
        );

        stateManager.getTabGroup.mockResolvedValueOnce(NaN);
        expect(await bgModule.recoverGroupFromSessionHistory({ id: 10 })).toBe(
          null,
        );
      });

      it('catches error and returns null', async () => {
        stateManager.getTabGroup.mockRejectedValueOnce(
          new Error('Storage failure'),
        );
        expect(await bgModule.recoverGroupFromSessionHistory({ id: 10 })).toBe(
          null,
        );
      });
    });

    describe('initializeTabGroupAssignments', () => {
      beforeEach(() => {
        vi.useFakeTimers();
        globalThis.browser.windows.getAll.mockResolvedValue([{ id: 1 }]);
        globalThis.browser.tabs.query.mockResolvedValue([
          { id: 10, windowId: 1 },
          { id: 11, windowId: 1 },
        ]);
        stateManager.getGroups.mockResolvedValue([{ id: 5 }]);
        globalThis.browser.sessions.getWindowValue = vi
          .fn()
          .mockResolvedValue(true);
      });

      afterEach(() => {
        vi.useRealTimers();
      });

      it('handles successful initialization with session recovery', async () => {
        // Tab 10 recovered to group 5
        stateManager.getTabGroup.mockImplementation(async (tabId) =>
          tabId === 10 ? 5 : null,
        );

        const initPromise = bgModule.initializeTabGroupAssignments();
        vi.runAllTimers(); // Trigger timeouts
        await initPromise;

        expect(bgModule.initializationState.isInitializing).toBe(false);
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, 5); // Recovered
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(11, -2); // Unrecovered -> ungrouped
      });

      it('assigns to ungrouped if recovered group no longer exists', async () => {
        stateManager.getGroups.mockResolvedValue([{ id: 999 }]); // Group 5 doesn't exist
        stateManager.getTabGroup.mockResolvedValue(5); // Recovered group 5

        const initPromise = bgModule.initializeTabGroupAssignments();
        vi.runAllTimers();
        await initPromise;

        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, -2);
      });

      it('warns when session history is disabled', async () => {
        globalThis.browser.sessions.getRecentlyClosed = vi
          .fn()
          .mockRejectedValueOnce(new Error('disabled'));
        stateManager.getTabGroup.mockResolvedValue(5);

        const initPromise = bgModule.initializeTabGroupAssignments();
        vi.runAllTimers();
        await initPromise;

        // Session history disabled -> doesn't call getTabGroup, assigns to ungrouped
        expect(stateManager.getTabGroup).not.toHaveBeenCalled();
        expect(stateManager.setTabGroup).toHaveBeenCalledWith(10, -2);
      });

      it('catches and logs errors during initialization', async () => {
        globalThis.browser.windows.getAll.mockRejectedValueOnce(
          new Error('Window error'),
        );

        const initPromise = bgModule.initializeTabGroupAssignments();
        vi.runAllTimers();
        await initPromise;

        expect(bgModule.initializationState.isInitializing).toBe(false);
      });
    });
  });

  describe('import-time init()', () => {
    const importFresh = async () => {
      vi.resetModules();
      const { stateManager: freshStateManager } =
        await import('../../src/js/background/StateManager.js');
      return freshStateManager;
    };

    it('moves tabs whose group no longer exists into the active group', async () => {
      const sm = await importFresh();
      globalThis.browser.windows.getAll.mockResolvedValue([{ id: 1 }]);
      globalThis.browser.tabs.query.mockResolvedValue([
        { id: 5, windowId: 1 },
        { id: 6, windowId: 2 },
      ]);
      sm.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);
      sm.getTabGroup.mockResolvedValue(99);
      sm.getActiveGroup.mockResolvedValue(1);

      const bg = await import('../../src/js/background.js');
      await vi.waitFor(() => {
        expect(bg.initializationState.isInitializing).toBe(false);
      });

      // Tab 5 is in window 1, which has groups, and its group 99 does not exist
      expect(sm.setTabGroup).toHaveBeenCalledWith(5, 1);
      // Tab 6 is in a window without a groups lookup, so it is skipped
      expect(sm.setTabGroup).not.toHaveBeenCalledWith(6, 1);
    });

    it('skips windows that have no groups yet', async () => {
      const sm = await importFresh();
      globalThis.browser.windows.getAll.mockResolvedValue([{ id: 1 }]);
      sm.getGroups.mockResolvedValue([]);

      const bg = await import('../../src/js/background.js');
      await vi.waitFor(() => {
        expect(bg.initializationState.isInitializing).toBe(false);
      });

      expect(sm.getGroups).toHaveBeenCalledWith(1);
    });
  });
});
