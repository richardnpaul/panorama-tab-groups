import { loadOptions } from './_share/options.js';
import { stateManager } from './background/StateManager.js';
import { mod, getColorForGroupId } from './background/utils.js';
import { createMenuList, handleMenuChange } from './background/menu-manager.js';
import { migrateToHybridGroups, setupTabGroupListeners } from './background/native-groups.js';

const manifest = browser.runtime.getManifest();

// Debug flag - set to false for production
const DEBUG = true;

// API Feature Detection
const hasTabHide = typeof browser.tabs.hide !== 'undefined'; // Firefox 61+ only
const hasTabGroups = typeof browser.tabGroups?.query === 'function' && typeof browser.tabs?.group === 'function'; // Firefox 139+, Chrome 89+

// Determine operating mode
let browserMode = 'unsupported';
if (hasTabHide && hasTabGroups) {
  browserMode = 'hybrid'; // Best: hide/show + native groups
} else if (hasTabGroups) {
  browserMode = 'collapse-only'; // Chrome/Edge: native groups only
} else if (hasTabHide) {
  browserMode = 'legacy'; // Old Firefox: hide/show only
}

// Log detected capabilities once on load
if (DEBUG) {
  console.log('Browser capabilities:', {
    tabHide: hasTabHide,
    tabGroups: hasTabGroups,
    mode: browserMode,
  });
}

window.backgroundState = {
  openingView: null, // Changed: stores { tabId, timeout, windowId } or null
  openingBackup: false,
};

// Per-window state tracking for multi-window support
window.windowStates = new Map(); // windowId -> { viewTabId }

function getWindowState(windowId) {
  if (!window.windowStates.has(windowId)) {
    window.windowStates.set(windowId, {
      viewTabId: null,
    });
  }
  return window.windowStates.get(windowId);
}

window.viewRefreshOrdered = false;

/** Set extension icon tooltip and numGroups to icon * */
async function setActionTitle(windowId, activeGroup = null) {
  let name;
  const groups = await stateManager.getGroups(windowId);

  if (activeGroup === null) {
    activeGroup = await stateManager.getActiveGroup(windowId);
  }

  groups.forEach((group) => {
    if (group.id === activeGroup) {
      name = group.name;
    }
  });
  browser.action.setTitle({ title: `Active Group: ${name}`, windowId });
  browser.action.setBadgeText({ text: String(groups.length), windowId });
  browser.action.setBadgeBackgroundColor({ color: '#666666' });
}

async function toggleVisibleTabs(activeGroup, noTabSelected) {
  if (DEBUG) {
    const stack = new Error().stack.split('\n').slice(2, 5).join('\n');
    console.log(`toggleVisibleTabs called: activeGroup=${activeGroup}, noTabSelected=${noTabSelected}`);
    console.log(`  Call stack:\n${stack}`);
  }

  // Show and hide the appropriate tabs
  const tabs = await browser.tabs.query({ currentWindow: true });
  const windowId = (await browser.windows.getCurrent()).id;

  const showTabIds = [];
  const hideTabIds = [];
  const showTabs = [];

  await Promise.all(tabs.map(async (tab) => {
    try {
      // Skip pinned tabs - they should always be visible
      if (tab.pinned) {
        if (DEBUG) {
          console.log(`  Skipping pinned tab: ${tab.id} (${tab.title})`);
        }
        return;
      }

      // Handle panorama view tab (groupId -1)
      // Show it when activeGroup is -1 (view is active), hide it otherwise
      const groupId = await stateManager.getTabGroup(tab.id);
      if (groupId === -1) {
        if (activeGroup === -1) {
          showTabIds.push(tab.id);
          showTabs.push(tab);
          if (DEBUG) {
            console.log(`  Will show panorama view tab ${tab.id}`);
          }
        } else {
          hideTabIds.push(tab.id);
          if (DEBUG) {
            console.log(`  Will hide panorama view tab ${tab.id}`);
          }
        }
        return;
      }

      if (groupId !== activeGroup) {
        hideTabIds.push(tab.id);
        if (DEBUG) {
          console.log(`  Will hide tab ${tab.id} (${tab.title}) - groupId ${groupId}`);
        }
      } else {
        showTabIds.push(tab.id);
        showTabs.push(tab);
        if (DEBUG) {
          console.log(`  Will show tab ${tab.id} (${tab.title}) - groupId ${groupId}`);
        }
      }
    } catch {
      // The tab has probably been closed, this should be safe to ignore
    }
  }));

  if (noTabSelected) {
    showTabs.sort((tabA, tabB) => tabB.lastAccessed - tabA.lastAccessed);
    await browser.tabs.update(showTabs[0].id, { active: true });
  }

  // Get groups for native group management
  const groups = hasTabGroups ? await stateManager.getGroups(windowId) : null;

  // Step 1: Collapse and hide inactive groups
  if (hideTabIds.length > 0) {
    // Collapse native groups first (if available)
    if (hasTabGroups && groups) {
      await Promise.all(groups.map(async (group) => {
        if (group.nativeGroupId && group.id !== activeGroup) {
          try {
            await browser.tabGroups.update(group.nativeGroupId, { collapsed: true });
          } catch (error) {
            // Group might not exist anymore, ignore
          }
        }
      }));
    }

    // Then hide tabs (Firefox only)
    if (hasTabHide) {
      await browser.tabs.hide(hideTabIds);
    }
  }

  // Step 2: Show and uncollapse active group
  if (showTabIds.length > 0) {
    // Show tabs first (Firefox only)
    if (hasTabHide) {
      await browser.tabs.show(showTabIds);
    }

    // Then uncollapse native group (if available)
    if (hasTabGroups && groups) {
      const activeGroupData = groups.find((g) => g.id === activeGroup);
      if (activeGroupData && activeGroupData.nativeGroupId) {
        try {
          await browser.tabGroups.update(activeGroupData.nativeGroupId, { collapsed: false });
        } catch (error) {
          // Group might not exist anymore, ignore
        }
      }
    }
  }

  if (activeGroup >= 0) {
    const window = await browser.windows.getLastFocused();
    await setActionTitle(window.id, activeGroup);
  }
}

async function moveTab(tabId, groupId) {
  const windowId = (await browser.windows.getCurrent()).id;
  await stateManager.setTabGroup(tabId, groupId);

  // Also move tab to native browser group if available (but only for visible tabs)
  if (hasTabGroups) {
    try {
      const groups = await stateManager.getGroups(windowId);
      const targetGroup = groups.find((g) => g.id === parseInt(groupId, 10));
      const activeGroup = await stateManager.getActiveGroup(windowId);

      // Only assign to native group if this is the currently active group
      // This prevents conflicts with hidden tabs
      if (targetGroup && targetGroup.nativeGroupId && parseInt(groupId, 10) === activeGroup) {
        await browser.tabs.group({
          tabIds: [tabId],
          groupId: targetGroup.nativeGroupId,
        });
      } else if (targetGroup && targetGroup.nativeGroupId) {
        // For inactive groups, remove from native groups to avoid confusion
        await browser.tabs.ungroup([tabId]);
      }
    } catch (error) {
      // Native tabGroups might not be available or tab might not exist
      console.warn('Could not assign tab to native group:', error);
    }
  }

  const toIndex = -1;
  await browser.tabs.move(tabId, { index: toIndex });

  const activeGroup = await stateManager.getActiveGroup(windowId);
  await toggleVisibleTabs(activeGroup);
}

async function menuClicked(info, tab) {
  switch (info.menuItemId) {
    case 'refresh-groups': {
      browser.menus.removeAll();
      createMenuList();
      break;
    }
    default: {
      // see if we're sending multiple tabs
      const tabs = await browser.tabs.query({ highlighted: true });
      // if you select multiple tabs, your active tab is selected as well
      // and needs to be filtered out
      if (tabs.length > 1) {
        const activeTabId = (await browser.tabs.query({ active: true }))[0].id;
        tabs.forEach((tempTab) => {
          const tabId = tempTab.id;
          if (tabId !== activeTabId) {
            moveTab(tabId, info.menuItemId);
          }
        });
      } else {
      // otherwise just use the tab where the menu was clicked from
      // if you don't do multiselect, but just right click, the tab isn't actually highlighted
        const activeTabId = (await browser.tabs.query({ active: true }))[0].id;
        if (activeTabId === tab.id) {
          const visibleTabs = (await browser.tabs.query({ hidden: false }));

          // find position of active tab among visible tabs
          let tabIndex = 0;
          visibleTabs.forEach((visibleTab, index) => {
            if (visibleTab.id === tab.id) {
              tabIndex = parseInt(index, 10);
            }
          });

          // find neighboring tab and make it the active tab
          let newActiveTab = tab;
          if (visibleTabs[tabIndex - 1] !== undefined) {
            newActiveTab = visibleTabs[tabIndex - 1];
          } else if (visibleTabs[tabIndex + 1] !== undefined) {
            newActiveTab = visibleTabs[tabIndex + 1];
          }
          await browser.tabs.update(newActiveTab.id, { active: true });
        }

        moveTab(tab.id, info.menuItemId);
      }
    }
  }
}

browser.menus.onClicked.addListener(menuClicked);

/** Shift current active group by offset */
async function changeActiveGroupBy(offset) {
  const windowId = (await browser.windows.getCurrent()).id;
  const groups = await stateManager.getGroups(windowId);

  let activeGroup = await stateManager.getActiveGroup(windowId);
  const activeIndex = groups.findIndex((group) => group.id === activeGroup);
  const newIndex = activeIndex + offset;

  activeGroup = groups[mod(newIndex, groups.length)].id;
  await stateManager.setActiveGroup(windowId, activeGroup);

  await toggleVisibleTabs(activeGroup, true);
}

async function triggerCommand(command) {
  const options = await loadOptions();

  if (options.shortcut[command].disabled) {
    // Doesn't execute disabled command
    return;
  }
  if (command === 'activate-next-group') {
    await changeActiveGroupBy(1);
  } else if (command === 'activate-previous-group') {
    await changeActiveGroupBy(-1);
  }
}

/** Open the Panorama View tab, or return to the last open tab if Panorama View is currently open */
async function toggleView() {
  const windowId = (await browser.windows.getCurrent()).id;
  const windowState = getWindowState(windowId);
  const extTabs = await browser.tabs.query({ url: browser.runtime.getURL('view.html'), windowId });

  if (extTabs.length > 0) {
    // Update tracked viewTabId
    windowState.viewTabId = extTabs[0].id;

    const currentTab = (await browser.tabs.query({ active: true, currentWindow: true }))[0];
    // switch to last accessed tab in window
    if (extTabs[0].id === currentTab.id) {
      const tabs = await browser.tabs.query({ currentWindow: true });
      tabs.sort((tabA, tabB) => tabB.lastAccessed - tabA.lastAccessed);

      // skip first tab which will be the panorama view
      if (tabs.length > 1) {
        await browser.tabs.update(tabs[1].id, { active: true });
      }

      // switch to Panorama View tab
    } else {
      await browser.tabs.update(extTabs[0].id, { active: true });
    }
  } else { // if there is no Panorama View tab, make one
    // Clear any existing timeout if we're re-creating
    if (window.backgroundState.openingView) {
      clearTimeout(window.backgroundState.openingView.timeout);
    }

    // Set up tracking state BEFORE creating tab to catch synchronous tabCreated events
    const creationTimestamp = Date.now();
    const timeout = setTimeout(() => {
      if (DEBUG) {
        console.warn('View tab creation timed out, clearing state');
      }
      window.backgroundState.openingView = null;
    }, 5000);

    window.backgroundState.openingView = {
      tabId: null, // Will be set after creation
      timeout,
      windowId,
      creationTimestamp, // Used to identify view tab if tabCreated fires early
    };

    // Create the tab
    const tab = await browser.tabs.create({ url: '/view.html', active: true });

    // Update state with actual tab ID (if state hasn't been cleared by tabCreated)
    if (window.backgroundState.openingView?.creationTimestamp === creationTimestamp) {
      window.backgroundState.openingView.tabId = tab.id;
    }

    // Track in per-window state
    windowState.viewTabId = tab.id;
  }
}

/** Callback function which will be called whenever a tab is opened */
async function tabCreated(tab) {
  if (window.backgroundState.openingBackup) {
    return;
  }

  // Check if this is the panorama view tab
  // Use multiple checks: tabId match, window match + recent creation, or URL match
  const viewUrl = browser.runtime.getURL('view.html');
  const now = Date.now();
  const isViewTabById = window.backgroundState.openingView?.tabId === tab.id;
  const isViewTabByWindow = window.backgroundState.openingView?.windowId === tab.windowId
                            && window.backgroundState.openingView?.creationTimestamp
                            && (now - window.backgroundState.openingView.creationTimestamp) < 100;
  const isViewTabByUrl = tab.url === viewUrl || tab.pendingUrl === viewUrl;

  if (DEBUG) {
    console.log(`tabCreated: tab ${tab.id}, url="${tab.url}", pendingUrl="${tab.pendingUrl}", viewUrl="${viewUrl}", isViewTabById=${isViewTabById}, isViewTabByWindow=${isViewTabByWindow}, isViewTabByUrl=${isViewTabByUrl}`);
  }

  if (isViewTabById || isViewTabByWindow || isViewTabByUrl) {
    // Clear the timeout and state
    if (window.backgroundState.openingView) {
      clearTimeout(window.backgroundState.openingView.timeout);
      window.backgroundState.openingView = null;
    }

    // Assign special group ID for panorama view tab
    await stateManager.setTabGroup(tab.id, -1);
    if (DEBUG) {
      console.log(`Created panorama view tab ${tab.id}, assigned groupId -1`);
    }
    return;
  }

  // Normal case: everything except the Panorama View tab
  // If the tab does not have a group, set its group to the current group
  let tabGroupId = await stateManager.getTabGroup(tab.id);
  if (tabGroupId === undefined) {
    const activeGroup = await stateManager.getActiveGroup(tab.windowId);
    await stateManager.setTabGroup(tab.id, activeGroup);
    tabGroupId = activeGroup;
    if (DEBUG) {
      console.log(`Tab ${tab.id} had no group, assigned to activeGroup ${activeGroup}`);
    }
  }

  // Assign to native browser group (do this regardless of whether groupId was already set)
  // This ensures tabs created by Group.addNewTab() get properly assigned to native groups
  if (hasTabGroups && tabGroupId !== -1) {
    try {
      const groups = await stateManager.getGroups(tab.windowId);
      const currentGroup = groups?.find((g) => g.id === tabGroupId);
      const activeGroup = await stateManager.getActiveGroup(tab.windowId);

      // If group doesn't have a native group yet, create one now
      if (currentGroup && !currentGroup.nativeGroupId) {
        // Get all tabs in this group
        const allTabs = await browser.tabs.query({ windowId: tab.windowId });
        const tabGroupIds = await stateManager.getTabGroups(
          allTabs.map((t) => t.id),
        );
        const groupTabs = allTabs
          .filter((t, index) => tabGroupIds[index] === tabGroupId)
          .map((t) => t.id);

        if (groupTabs.length > 0) {
          // Create native group by grouping the tabs
          const nativeGroupId = await browser.tabs.group({ tabIds: groupTabs });

          // Update the native group with title and color
          await browser.tabGroups.update(nativeGroupId, {
            title: currentGroup.name || `Group ${tabGroupId}`,
            color: getColorForGroupId(tabGroupId),
          });

          // Store the native group ID
          currentGroup.nativeGroupId = nativeGroupId;
          await stateManager.setGroups(tab.windowId, groups);

          if (DEBUG) {
            console.log(`Created native group ${nativeGroupId} for panorama group ${tabGroupId} with ${groupTabs.length} tabs (from tabCreated)`);
          }

          // Update visibility to hide panorama view tab since we now have an active tab in a group
          if (tab.active || tabGroupId === activeGroup) {
            if (DEBUG) {
              console.log(`Updating visibility for newly created native group (tab.active=${tab.active}, tabGroupId=${tabGroupId}, activeGroup=${activeGroup})`);
            }
            await toggleVisibleTabs(tabGroupId);
          }
        }
      } else if (currentGroup && currentGroup.nativeGroupId && tabGroupId === activeGroup) {
        // Group has native group and is active, assign tab to it
        await browser.tabs.group({
          tabIds: [tab.id],
          groupId: currentGroup.nativeGroupId,
        });
        if (DEBUG) {
          console.log(`Assigned tab ${tab.id} to native group ${currentGroup.nativeGroupId} (panorama group ${tabGroupId})`);
        }

        // Update visibility to hide panorama view tab since we now have an active tab in this group
        if (tab.active) {
          if (DEBUG) {
            console.log(`Updating visibility for existing native group (tab.active=${tab.active}, tabGroupId=${tabGroupId})`);
          }
          await toggleVisibleTabs(tabGroupId);
        }
      } else if (DEBUG) {
        console.log(`Skipped native group assignment for tab ${tab.id}: group inactive (will be grouped when activated)`);
      }
    } catch (error) {
      // Native tabGroups might not be available
      console.warn('Could not assign new tab to native group:', error);
    }
  }
}

async function tabAttached(tabId, attachInfo) { // eslint-disable-line no-unused-vars
  const tab = await browser.tabs.get(tabId);
  await tabCreated(tab);
}

async function tabDetached(tabId, detachInfo) { // eslint-disable-line no-unused-vars
  await browser.sessions.removeTabValue(tabId, 'groupId');
}

/** Callback function which will be called whenever the user switches tabs.
 * This callback needed for properly switch between groups, when current tab
 * is from another group (or is Panorama Tab Groups tab).
 */
async function tabActivated(activeInfo) {
  const tab = await browser.tabs.get(activeInfo.tabId);

  if (tab.pinned) {
    return;
  }

  // Set the window's active group to the new active tab's group
  // If this is a newly-created tab, tabCreated() might not have set a
  // groupId yet, so retry until it does.
  const activeGroup = await stateManager.getTabGroup(activeInfo.tabId);

  if (activeGroup !== -1) {
    // activated tab is not Panorama View tab
    await stateManager.setActiveGroup(tab.windowId, activeGroup);

    // Create native tab group if needed (for groups created in panorama view)
    if (hasTabGroups) {
      const groups = await stateManager.getGroups(tab.windowId);
      const currentGroup = groups?.find((g) => g.id === activeGroup);

      // Check if the current tab already has a native group assignment
      const currentTabGroups = await browser.tabGroups.query({ windowId: tab.windowId });
      const tabsInNativeGroups = await Promise.all(
        currentTabGroups.map(async (ng) => {
          const tabs = await browser.tabs.query({ groupId: ng.id });
          return { nativeGroupId: ng.id, tabIds: tabs.map((t) => t.id) };
        }),
      );
      const existingNativeGroup = tabsInNativeGroups.find((ng) => ng.tabIds.includes(tab.id));

      // If this group doesn't have a native group yet AND the tab isn't in one, create it
      if (currentGroup && !currentGroup.nativeGroupId && !existingNativeGroup) {
        try {
          // Get all tabs in this group
          const allTabs = await browser.tabs.query({ windowId: tab.windowId });
          const tabGroupIds = await stateManager.getTabGroups(
            allTabs.map((t) => t.id),
          );
          const groupTabs = allTabs
            .filter((t, index) => tabGroupIds[index] === activeGroup)
            .map((t) => t.id);

          if (groupTabs.length > 0) {
            // Create native group by grouping the tabs
            const nativeGroupId = await browser.tabs.group({ tabIds: groupTabs });

            // Update the native group with title and color
            await browser.tabGroups.update(nativeGroupId, {
              title: currentGroup.name || `Group ${activeGroup}`,
              color: getColorForGroupId(activeGroup),
            });

            // Store the native group ID
            currentGroup.nativeGroupId = nativeGroupId;
            await stateManager.setGroups(tab.windowId, groups);

            if (DEBUG) {
              console.log(`Created native group ${nativeGroupId} for panorama group ${activeGroup} with ${groupTabs.length} tabs`);
            }
          }
        } catch (error) {
          console.warn('Could not create native tab group:', error);
        }
      } else if (currentGroup && !currentGroup.nativeGroupId && existingNativeGroup) {
        // Tab is already in a native group, just store the reference
        currentGroup.nativeGroupId = existingNativeGroup.nativeGroupId;
        await stateManager.setGroups(tab.windowId, groups);
        if (DEBUG) {
          console.log(`Linked existing native group ${existingNativeGroup.nativeGroupId} to panorama group ${activeGroup}`);
        }
      }
    }
  }

  await toggleVisibleTabs(activeGroup);
}

/** Get a new UID for a group */
async function newGroupUid(windowId) {
  const groupIndex = await stateManager.getGroupIndex(windowId);

  const uid = groupIndex || 0;
  const newGroupIndex = uid + 1;

  await stateManager.setGroupIndex(windowId, newGroupIndex);

  return uid;
}

/** Create the first group in a window
 * This handles new windows and, during installation, existing windows
 * that do not yet have a group */
async function createGroupInWindow(browserWindow) {
  if (window.backgroundState.openingBackup) {
    console.log('Skipping creation of groups since we are opening backup');
    return;
  }

  const groupId = await newGroupUid(browserWindow.id);

  // Native group will be created later when tabs are assigned to this group
  // (browser.tabGroups.create() doesn't exist - must use browser.tabs.group() with actual tabs)
  const nativeGroupId = null;

  const groups = [{
    id: groupId,
    name: `${groupId}: ${browser.i18n.getMessage('defaultGroupName')}`,
    containerId: 'firefox-default',
    nativeGroupId, // Store reference to native group
    rect: {
      x: 0, y: 0, w: 0.5, h: 0.5,
    },
    lastMoved: (new Date()).getTime(),
  }];

  await stateManager.setGroups(browserWindow.id, groups);
  await stateManager.setActiveGroup(browserWindow.id, groupId);
}
/** Checks that group is missing before creating new one in window
 * This makes sure existing/restored windows are not reinitialized.
 * For example, windows that are restored by user (e.g. Ctrl+Shift+N) will
 * trigger the onCreated event but still have the existing group data.
 */
async function createGroupInWindowIfMissing(browserWindow) {
  const groups = await stateManager.getGroups(browserWindow.id);

  if (!groups || !groups.length) {
    console.log(`No groups found for window ${browserWindow.id}!`);
    await createGroupInWindow(browserWindow);
  }
  browser.action.setTitle({ title: 'Active Group: Unnamed group', windowId: browserWindow.id });
  browser.action.setBadgeText({ text: '1', windowId: browserWindow.id });
  browser.action.setBadgeBackgroundColor({ color: '#666666' });
}
/** Make sure each window has a group */
async function setupWindows() {
  const windows = await browser.windows.getAll({});

  await Promise.all(windows.map(async (window) => {
    await createGroupInWindowIfMissing(window);
  }));
}

/** Put any tabs that do not have a group into the active group */
async function salvageGrouplessTabs() {
  // make array of all groups for quick look-up
  const windows = {};
  const tWindows = await browser.windows.getAll({});

  // Use Promise.all to ensure all async operations complete
  await Promise.all(tWindows.map(async (window) => {
    windows[window.id] = { groups: null };
    windows[window.id].groups = await stateManager.getGroups(window.id);
  }));

  // check all tabs
  const tabs = await browser.tabs.query({});

  await Promise.all(tabs.map(async (tab) => {
    const groupId = await stateManager.getTabGroup(tab.id);

    // Check if windows[tab.windowId] and its groups exist
    if (!windows[tab.windowId] || !windows[tab.windowId].groups) {
      console.log(`No groups found for window ${tab.windowId}, skipping tab ${tab.id}`);
      return;
    }

    let groupExists = false;
    windows[tab.windowId].groups.forEach((group) => {
      if (group.id === groupId) {
        groupExists = true;
      }
    });

    if (!groupExists && groupId !== -1) {
      const activeGroup = await stateManager.getActiveGroup(tab.windowId);
      await stateManager.setTabGroup(tab.id, activeGroup);
    }
  }));
}

/**
 * Migration Utility: Convert existing groups to hybrid system with native tab groups
 * This ensures existing users' groups get native tab group counterparts
 */

async function init() {
  const options = await loadOptions();

  console.log('Initializing Panorama Tab View');

  await setupWindows();
  await salvageGrouplessTabs();

  // Migrate existing groups to hybrid system with native tab groups
  await migrateToHybridGroups(hasTabGroups, DEBUG);

  // Create menus after groups are initialized
  await createMenuList();

  if (DEBUG) {
    console.log('Finished setup');
  }

  const disablePopupView = options.view !== 'popup';
  if (disablePopupView) {
    // Disable popup
    browser.action.setPopup({
      popup: '',
    });

    browser.action.onClicked.addListener(toggleView);
  }

  browser.commands.onCommand.addListener(triggerCommand);
  browser.windows.onCreated.addListener(createGroupInWindowIfMissing);
  browser.tabs.onCreated.addListener(tabCreated);
  browser.tabs.onAttached.addListener(tabAttached);
  browser.tabs.onDetached.addListener(tabDetached);
  browser.tabs.onActivated.addListener(tabActivated);

  // Add tab removal listener to cleanup openingView state
  browser.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
    // Clear openingView state if the view tab is removed before completion
    if (window.backgroundState.openingView?.tabId === tabId) {
      clearTimeout(window.backgroundState.openingView.timeout);
      window.backgroundState.openingView = null;
      if (DEBUG) {
        console.log('View tab removed during creation, cleared state');
      }
    }

    // Clear per-window viewTabId tracking
    const windowState = getWindowState(removeInfo.windowId);
    if (windowState.viewTabId === tabId) {
      windowState.viewTabId = null;
    }
  });

  // Add window removal listener to cleanup per-window state
  browser.windows.onRemoved.addListener((windowId) => {
    window.windowStates.delete(windowId);
    if (DEBUG) {
      console.log(`Cleaned up state for closed window ${windowId}`);
    }
  });

  // Add native tabGroups event listeners for hybrid functionality
  setupTabGroupListeners(hasTabGroups, DEBUG);
}

init();

window.refreshView = async function refreshView() {
  const options = await loadOptions();

  console.log('Refresh Panorama Tab View');
  window.viewRefreshOrdered = true;

  browser.action.onClicked.removeListener(toggleView);
  browser.commands.onCommand.removeListener(triggerCommand);
  browser.windows.onCreated.removeListener(createGroupInWindowIfMissing);
  browser.tabs.onCreated.removeListener(tabCreated);
  browser.tabs.onAttached.removeListener(tabAttached);
  browser.tabs.onDetached.removeListener(tabDetached);
  browser.tabs.onActivated.removeListener(tabActivated);

  const disablePopupView = options.view !== 'popup';
  if (disablePopupView) {
    // Disable popup
    browser.action.setPopup({
      popup: '',
    });

    browser.action.onClicked.addListener(toggleView);
  } else {
    // Re-enable popup
    browser.action.setPopup({
      popup: 'popup-view/index.html',
    });
  }

  browser.commands.onCommand.addListener(triggerCommand);
  browser.windows.onCreated.addListener(createGroupInWindowIfMissing);
  browser.tabs.onCreated.addListener(tabCreated);
  browser.tabs.onAttached.addListener(tabAttached);
  browser.tabs.onDetached.addListener(tabDetached);
  browser.tabs.onActivated.addListener(tabActivated);
};

// TODO: Remove? Is this used?
function handleMessage(message, sender) { // eslint-disable-line no-unused-vars
  if (message === 'activate-next-group') {
    triggerCommand('activate-next-group');
  } else if (message === 'activate-previous-group') {
    triggerCommand('activate-previous-group');
  }
}

// Handle internal extension messages
function handleInternalMessage(message, sender, sendResponse) {
  switch (message.action) {
    case 'createMenuItem':
    case 'removeMenuItem':
    case 'updateMenuItem':
      // Handle menu change messages
      handleMenuChange(message);
      break;
    case 'setBackgroundState':
      window.backgroundState[message.key] = message.value;
      break;
    case 'refreshView':
      window.refreshView();
      break;
    case 'checkViewRefresh':
      sendResponse({ viewRefreshOrdered: window.viewRefreshOrdered });
      break;
    case 'clearViewRefresh':
      window.viewRefreshOrdered = false;
      break;
    case 'migrateToHybridGroups':
      // Manual trigger for migration
      migrateToHybridGroups(hasTabGroups, DEBUG).then(() => {
        sendResponse({ success: true, message: 'Migration completed' });
      }).catch((error) => {
        sendResponse({ success: false, message: error.message });
      });
      return true; // Keep channel open for async response
    case 'resetMigration':
      // Reset migration flag for testing
      browser.storage.local.set({ hybridGroupsMigrationComplete: false }).then(() => {
        sendResponse({ success: true, message: 'Migration flag reset' });
      });
      return true;
    default:
      // Unknown action
      break;
  }
  return false;
}

browser.runtime.onMessage.addListener(handleInternalMessage);
browser.runtime.onMessageExternal.addListener(handleMessage);

/*
 * Handle upboarding
 */
function onRuntimeInstallNotification(details) {
  if (details.temporary) return;
  // Open new tab to the release notes after update
  if (details.reason === 'update') {
    browser.tabs.create({
      url: `https://github.com/projectdelphai/panorama-tab-groups/releases/tag/${manifest.version}`,
    });
  }
}

browser.runtime.onInstalled.addListener(onRuntimeInstallNotification);
