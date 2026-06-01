import './setup.js';
import {
  tabAttached,
  tabDetached,
  tabCreated,
} from '../../src/js/background.js';
import { stateManager } from '../../src/js/background/StateManager.js';

let stateManagerSetTabGroupMock = null;
let stateManagerGetActiveGroupMock = null;
let stateManagerGetTabGroupMock = null;
let browserSessionsRemoveTabValueMock = null;

let originalSetTabGroup = null;
let originalGetActiveGroup = null;
let originalGetTabGroup = null;
let originalSessionsRemoveTabValue = null;

beforeEach(() => {
  stateManagerSetTabGroupMock = null;
  stateManagerGetActiveGroupMock = null;
  stateManagerGetTabGroupMock = null;
  browserSessionsRemoveTabValueMock = null;

  // Override specific stateManager methods
  originalSetTabGroup = stateManager.setTabGroup;
  originalGetActiveGroup = stateManager.getActiveGroup;
  originalGetTabGroup = stateManager.getTabGroup;
  originalSessionsRemoveTabValue = globalThis.browser.sessions.removeTabValue;

  stateManager.setTabGroup = async (tabId, groupId) => {
    if (stateManagerSetTabGroupMock) {
      return stateManagerSetTabGroupMock(tabId, groupId);
    }
    return undefined;
  };

  stateManager.getActiveGroup = async (windowId) => {
    if (stateManagerGetActiveGroupMock) {
      return stateManagerGetActiveGroupMock(windowId);
    }
    return undefined;
  };

  stateManager.getTabGroup = async (tabId) => {
    if (stateManagerGetTabGroupMock) {
      return stateManagerGetTabGroupMock(tabId);
    }
    return null;
  };

  // Mock sessions.removeTabValue for tabDetached
  globalThis.browser.sessions.removeTabValue = async (tabId, key) => {
    if (browserSessionsRemoveTabValueMock) {
      return browserSessionsRemoveTabValueMock(tabId, key);
    }
    return undefined;
  };
});

afterEach(() => {
  // Restore original methods
  stateManager.setTabGroup = originalSetTabGroup;
  stateManager.getActiveGroup = originalGetActiveGroup;
  stateManager.getTabGroup = originalGetTabGroup;
  globalThis.browser.sessions.removeTabValue = originalSessionsRemoveTabValue;
});

describe('Background script tab lifecycle', () => {
  it('tabAttached assigns tab to the new window active group', async () => {
    let assignedTabId = null;
    let assignedGroupId = null;

    stateManagerSetTabGroupMock = async (tabId, groupId) => {
      assignedTabId = tabId;
      assignedGroupId = groupId;
    };

    stateManagerGetActiveGroupMock = async (windowId) => {
      if (windowId === 99) return 42;
      return null;
    };

    await tabAttached(100, { newWindowId: 99 });

    expect(assignedTabId).toBe(100);
    expect(assignedGroupId).toBe(42);
  });

  it('tabDetached removes the groupId session value', async () => {
    let removedTabId = null;
    let removedKey = null;

    browserSessionsRemoveTabValueMock = async (tabId, key) => {
      removedTabId = tabId;
      removedKey = key;
    };

    await tabDetached(100);

    expect(removedTabId).toBe(100);
    expect(removedKey).toBe('groupId');
  });

  it('tabCreated handles undefined group correctly', async () => {
    // This is a minimal test for tabCreated to increase coverage
    stateManagerGetTabGroupMock = async () => undefined;

    // We expect it not to crash
    await tabCreated({ id: 100, windowId: 1, active: false });
  });
});
