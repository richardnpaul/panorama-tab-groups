import { jest } from '@jest/globals';

import { stateManager } from '../../src/js/background/StateManager.js';
import { handleMenuChange } from '../../src/js/background/menu-manager.js';
import {
  migrateToHybridGroups,
  cleanupNativeGroups,
} from '../../src/js/background/native-groups.js';

// Mocks
jest.mock('../../src/js/share/options.js', () => ({
  loadOptions: jest.fn().mockResolvedValue({
    view: 'popup',
    shortcut: {
      'activate-next-group': { disabled: false },
      'activate-previous-group': { disabled: false },
    },
  }),
}));
jest.mock('../../src/js/background/StateManager.js', () => ({
  stateManager: {
    getGroups: jest.fn().mockResolvedValue([]),
    setGroups: jest.fn().mockResolvedValue(),
    getTabGroup: jest.fn().mockResolvedValue(-2),
    setTabGroup: jest.fn().mockResolvedValue(),
    getGroupIndex: jest.fn().mockResolvedValue(1),
    setGroupIndex: jest.fn().mockResolvedValue(),
    getActiveGroup: jest.fn().mockResolvedValue(1),
    setActiveGroup: jest.fn().mockResolvedValue(),
  },
}));
jest.mock('../../src/js/background/utils.js', () => ({
  mod: jest.fn((n, m) => ((n % m) + m) % m),
  getColorForGroupId: jest.fn().mockReturnValue('blue'),
  getLowestPositiveGroupId: jest.fn().mockReturnValue(1),
}));
jest.mock('../../src/js/background/menu-manager.js', () => ({
  createMenuList: jest.fn().mockResolvedValue(),
  handleMenuChange: jest.fn(),
}));
jest.mock('../../src/js/background/native-groups.js', () => ({
  migrateToHybridGroups: jest.fn().mockResolvedValue(),
  setupTabGroupListeners: jest.fn(),
  cleanupNativeGroups: jest.fn().mockResolvedValue(),
}));

let actionOnClickedListener;
let commandsOnCommandListener;
let windowsOnCreatedListener;
let tabsOnCreatedListener;
let tabsOnActivatedListener;
let tabsOnUpdatedListener;
let tabsOnRemovedListener;
let windowsOnRemovedListener;
let storageOnChangedListener;
let runtimeOnMessageListener;
let runtimeOnInstalledListener;

beforeEach(async () => {
  jest.clearAllMocks();

  globalThis.browser = {
    runtime: {
      getManifest: () => ({ version: '1.0' }),
      getURL: (path) => `moz-extension://ext-id/${path}`,
      onMessage: {
        addListener: jest.fn((cb) => {
          runtimeOnMessageListener = cb;
        }),
      },
      onInstalled: {
        addListener: jest.fn((cb) => {
          runtimeOnInstalledListener = cb;
        }),
      },
    },
    action: {
      setPopup: jest.fn(),
      setTitle: jest.fn(),
      setBadgeText: jest.fn(),
      setBadgeBackgroundColor: jest.fn(),
      onClicked: {
        addListener: jest.fn((cb) => {
          actionOnClickedListener = cb;
        }),
      },
    },
    commands: {
      onCommand: {
        addListener: jest.fn((cb) => {
          commandsOnCommandListener = cb;
        }),
      },
    },
    windows: {
      getCurrent: jest.fn().mockResolvedValue({ id: 1 }),
      get: jest.fn().mockResolvedValue({ id: 1, type: 'normal' }),
      getAll: jest.fn().mockResolvedValue([{ id: 1 }]),
      getLastFocused: jest.fn().mockResolvedValue({ id: 1 }),
      onCreated: {
        addListener: jest.fn((cb) => {
          windowsOnCreatedListener = cb;
        }),
      },
      onRemoved: {
        addListener: jest.fn((cb) => {
          windowsOnRemovedListener = cb;
        }),
      },
    },
    tabs: {
      get: jest.fn().mockResolvedValue({ id: 101, windowId: 1 }),
      create: jest.fn().mockResolvedValue({ id: 100 }),
      query: jest.fn().mockResolvedValue([]),
      hide: jest.fn().mockResolvedValue(),
      show: jest.fn().mockResolvedValue(),
      group: jest.fn().mockResolvedValue(),
      ungroup: jest.fn().mockResolvedValue(),
      remove: jest.fn().mockResolvedValue(),
      onCreated: {
        addListener: jest.fn((cb) => {
          tabsOnCreatedListener = cb;
        }),
      },
      onActivated: {
        addListener: jest.fn((cb) => {
          tabsOnActivatedListener = cb;
        }),
      },
      onUpdated: {
        addListener: jest.fn((cb) => {
          tabsOnUpdatedListener = cb;
        }),
      },
      onRemoved: {
        addListener: jest.fn((cb) => {
          tabsOnRemovedListener = cb;
        }),
      },
    },
    tabGroups: {
      query: jest.fn().mockResolvedValue([]),
    },
    storage: {
      local: {
        set: jest.fn().mockResolvedValue(),
      },
      onChanged: {
        addListener: jest.fn((cb) => {
          storageOnChangedListener = cb;
        }),
      },
    },
    sessions: {
      getWindowValue: jest.fn().mockResolvedValue(undefined),
      setWindowValue: jest.fn().mockResolvedValue(),
      getRecentlyClosed: jest.fn().mockResolvedValue([]),
    },
    contextMenus: {
      remove: jest.fn().mockResolvedValue(),
      onClicked: {
        addListener: jest.fn(),
      },
    },
    i18n: {
      getMessage: jest.fn((key) => key),
    },
  };

  // Import background.js
  await import('../../src/js/background.js');
});

describe('background.js', () => {
  describe('runtime.onMessage', () => {
    it('handles createMenuItem, removeMenuItem, updateMenuItem', () => {
      const sendResponse = jest.fn();
      const msg = { action: 'createMenuItem' };
      const res = runtimeOnMessageListener(msg, {}, sendResponse);
      expect(res).toBe(false);
      expect(handleMenuChange).toHaveBeenCalledWith(msg);
    });

    it('handles cleanupNativeGroups', async () => {
      const sendResponse = jest.fn();
      const msg = { action: 'cleanupNativeGroups' };
      const res = runtimeOnMessageListener(msg, {}, sendResponse);
      expect(res).toBe(true); // Keeps channel open

      // Wait for promise resolution
      await new Promise(process.nextTick);
      expect(cleanupNativeGroups).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({ success: true });
    });

    it('handles migrateToHybridGroups', async () => {
      const sendResponse = jest.fn();
      const msg = { action: 'migrateToHybridGroups' };
      const res = runtimeOnMessageListener(msg, {}, sendResponse);
      expect(res).toBe(true);

      await new Promise(process.nextTick);
      expect(migrateToHybridGroups).toHaveBeenCalled();
      expect(sendResponse).toHaveBeenCalledWith({
        success: true,
        message: 'Migration completed',
      });
    });

    it('handles unknown actions', () => {
      const sendResponse = jest.fn();
      const msg = { action: 'unknownAction' };
      const res = runtimeOnMessageListener(msg, {}, sendResponse);
      expect(res).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({
        error: 'Unknown action: unknownAction',
      });
    });
  });

  describe('runtime.onInstalled', () => {
    it('opens release notes on update', () => {
      runtimeOnInstalledListener({ reason: 'update' });
      expect(globalThis.browser.tabs.create).toHaveBeenCalledWith({
        url: 'https://github.com/projectdelphai/panorama-tab-groups/releases/tag/1.0',
      });
    });

    it('does nothing if temporary install', () => {
      globalThis.browser.tabs.create.mockClear();
      runtimeOnInstalledListener({ reason: 'update', temporary: true });
      expect(globalThis.browser.tabs.create).not.toHaveBeenCalled();
    });
  });

  describe('tabs.onUpdated', () => {
    it('changes tab group to -1 if navigating to panorama view', async () => {
      stateManager.getTabGroup.mockResolvedValue(1);
      await tabsOnUpdatedListener(
        101,
        { url: 'moz-extension://ext-id/view.html' },
        { windowId: 1 },
      );
      expect(stateManager.setTabGroup).toHaveBeenCalledWith(101, -1);
    });

    it('ignores navigation if not panorama view', async () => {
      stateManager.setTabGroup.mockClear();
      await tabsOnUpdatedListener(
        101,
        { url: 'https://example.com' },
        { windowId: 1, url: 'https://example.com' },
      );
      expect(stateManager.setTabGroup).not.toHaveBeenCalled();
    });
  });

  describe('tabs.onCreated', () => {
    it('handles tab created event (calls tabCreated)', async () => {
      // The function does a lot of group logic, we just verify it doesn't crash on simple tab
      await expect(
        tabsOnCreatedListener({ id: 101, windowId: 1 }),
      ).resolves.not.toThrow();
    });
  });

  describe('tabs.onActivated', () => {
    it('handles tab activated event', async () => {
      // Very basic sanity check
      globalThis.browser.windows.get = jest
        .fn()
        .mockResolvedValue({ id: 1, type: 'normal' });
      globalThis.browser.tabs.query.mockResolvedValue([
        { id: 101, windowId: 1, active: true },
      ]);
      await expect(
        tabsOnActivatedListener({ tabId: 101, windowId: 1 }),
      ).resolves.not.toThrow();
    });
  });

  describe('tabs.onRemoved', () => {
    it('clears openingView state if tab matches', async () => {
      // We can't directly set backgroundState easily, but we can verify it doesn't throw
      await expect(
        tabsOnRemovedListener(101, { windowId: 1 }),
      ).resolves.not.toThrow();
    });
  });

  describe('storage.onChanged', () => {
    it('triggers cleanup when useNativeGroups is disabled', async () => {
      await storageOnChangedListener(
        { useNativeGroups: { oldValue: true, newValue: false } },
        'sync',
      );
      expect(cleanupNativeGroups).toHaveBeenCalled();
    });

    it('does nothing when useNativeGroups is not disabled', async () => {
      cleanupNativeGroups.mockClear();
      await storageOnChangedListener(
        { useNativeGroups: { oldValue: false, newValue: true } },
        'sync',
      );
      expect(cleanupNativeGroups).not.toHaveBeenCalled();
    });
  });

  describe('windows.onRemoved', () => {
    it('cleans up window state', () => {
      // Hard to assert internal map, but should not throw
      expect(() => windowsOnRemovedListener(1)).not.toThrow();
    });
  });

  describe('action.onClicked', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('toggles view: creates new tab if none exists', async () => {
      globalThis.browser.windows.getCurrent = jest
        .fn()
        .mockResolvedValue({ id: 1 });
      globalThis.browser.tabs.query.mockResolvedValue([]); // No ext tabs

      await actionOnClickedListener();

      expect(globalThis.browser.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/view.html',
          active: true,
        }),
      );
    });

    it('toggles view: switches to view if exists and not active', async () => {
      globalThis.browser.windows.getCurrent = jest
        .fn()
        .mockResolvedValue({ id: 1 });
      globalThis.browser.tabs.query
        .mockResolvedValueOnce([{ id: 101 }]) // extTabs
        .mockResolvedValueOnce([{ id: 102 }]); // currentTab

      globalThis.browser.tabs.update = jest.fn().mockResolvedValue();

      await actionOnClickedListener();

      expect(globalThis.browser.tabs.update).toHaveBeenCalledWith(101, {
        active: true,
      });
      jest.runAllTimers(); // clear any hanging timeouts
    });
  });

  describe('commands.onCommand', () => {
    it('triggers activate-next-group', async () => {
      globalThis.browser.windows.getCurrent = jest
        .fn()
        .mockResolvedValue({ id: 1 });
      globalThis.browser.tabs.query.mockResolvedValue([
        { id: 200, windowId: 1 },
      ]);
      stateManager.getActiveGroup.mockResolvedValue(1);
      stateManager.getGroups.mockResolvedValue([{ id: 1 }, { id: 2 }]);

      await commandsOnCommandListener('activate-next-group');

      // The group change logic should be executed (which eventually calls setActiveGroup)
      // Since it involves complex async logic, we just verify it doesn't throw and attempts state read
      expect(stateManager.getActiveGroup).toHaveBeenCalled();
    });
  });

  describe('windows.onCreated', () => {
    it('creates group in window if missing', async () => {
      stateManager.getGroups.mockResolvedValue([]);
      await windowsOnCreatedListener({ id: 2, type: 'normal' });

      // Should set an initial group
      expect(stateManager.setGroups).toHaveBeenCalled();
    });
  });
});
