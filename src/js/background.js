import { loadOptions } from './_share/options.js';
import { stateManager } from './background/StateManager.js';
import {
  mod,
  getColorForGroupId,
  getLowestPositiveGroupId,
} from './background/utils.js';
import { createMenuList, handleMenuChange } from './background/menu-manager.js';
import {
  migrateToHybridGroups,
  setupTabGroupListeners,
  cleanupNativeGroups,
} from './background/native-groups.js';
import {
  PANORAMA_VIEW_GROUP_ID,
  UNGROUPED_GROUP_ID,
  UNGROUPED_GROUP_NAME,
  INITIALIZATION_TIMEOUT_MS,
  SHOW_LOADING_UI_AFTER_MS,
  isReservedGroupId,
  isValidUserGroupId,
} from './background/constants.js';

const manifest = browser.runtime.getManifest();

// Debug flag - set to false for production
const DEBUG = true;

// Initialization state
let initializationState = {
  isInitializing: true,
  startTime: null,
  showingUI: false,
  recoveredTabs: 0,
  assignedToUngrouped: 0,
};

/**
 * Helper: Enrich tab with full context for safe grouping operations
 */
async function enrichTabForGrouping(tab) {
  const panoramaGroupId = await stateManager.getTabGroup(tab.id);
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    panoramaGroupId,
    isPanoramaView: panoramaGroupId === PANORAMA_VIEW_GROUP_ID,
    isUngrouped: panoramaGroupId === UNGROUPED_GROUP_ID,
    nativeGroupId: tab.groupId !== -1 ? tab.groupId : null,
    title: tab.title,
  };
}

/**
 * Helper: Validate and check if tabs can be safely grouped
 */
async function validateAndCheckSafety(enrichedTabs, windowId, panoramaGroupId) {
  if (enrichedTabs.length === 0) {
    return { safe: false, reason: 'No tabs to group' };
  }

  // Check window exists
  try {
    await browser.windows.get(windowId);
  } catch (error) {
    return { safe: false, reason: `Window ${windowId} no longer exists` };
  }

  // Check for cross-window contamination
  const windowIds = new Set(enrichedTabs.map((t) => t.windowId));
  if (windowIds.size > 1) {
    return {
      safe: false,
      reason: `Cross-window: tabs from windows ${[...windowIds].join(', ')}`,
    };
  }

  // Check for mixed panorama groups
  const groupIds = new Set(enrichedTabs.map((t) => t.panoramaGroupId));
  if (groupIds.size > 1 || !groupIds.has(panoramaGroupId)) {
    return {
      safe: false,
      reason: `Group mismatch: expected ${panoramaGroupId}, got ${[...groupIds].join(', ')}`,
    };
  }

  // Check if grouping would leave window in bad state (single tab scenario)
  const allWindowTabs = await browser.tabs.query({ windowId });
  const viewUrl = browser.runtime.getURL('view.html');
  const nonPanoramaTabs = allWindowTabs.filter(
    (t) => t.url !== viewUrl && t.pendingUrl !== viewUrl,
  );

  if (
    enrichedTabs.length === nonPanoramaTabs.length &&
    nonPanoramaTabs.length === 1
  ) {
    return {
      safe: false,
      reason: 'Would group only tab in window (window closure risk)',
    };
  }

  return { safe: true };
}

// API Feature Detection
const hasTabHide = typeof browser.tabs.hide !== 'undefined'; // Firefox 61+ only
const hasTabGroups =
  typeof browser.tabGroups?.query === 'function' &&
  typeof browser.tabs?.group === 'function'; // Firefox 139+, Chrome 89+

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

/**
 * Check if native tab groups should be used
 * Requires both API availability AND user preference
 * @returns {Promise<boolean>}
 */
async function shouldUseNativeGroups() {
  if (!hasTabGroups) {
    return false; // API not available
  }
  const options = await loadOptions();
  return options.useNativeGroups !== false; // Default to true if not set
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
  const toggleStartTime = Date.now();
  if (DEBUG) {
    const stack = new Error().stack.split('\n').slice(2, 5).join('\n');
    console.log(
      `[ToggleVisibleTabs] START at ${toggleStartTime}: activeGroup=${activeGroup}, noTabSelected=${noTabSelected}`,
    );
    if (activeGroup === undefined) {
      console.warn(
        '[ToggleVisibleTabs] ⚠️ activeGroup is UNDEFINED - aborting to prevent hiding all tabs!',
      );
    }
    console.log(`  Call stack:\n${stack}`);
  }

  // Early return prevents catastrophic tab hiding bug when activeGroup is undefined
  if (activeGroup === undefined) {
    return;
  }

  // Validate activeGroup is valid (positive integer or -1 for panorama view)
  if (
    activeGroup !== PANORAMA_VIEW_GROUP_ID &&
    (activeGroup < 0 || !Number.isInteger(activeGroup))
  ) {
    console.error(
      `[ToggleVisibleTabs] Invalid activeGroup: ${activeGroup} - must be -1 or positive integer`,
    );
    return;
  }

  // Show and hide the appropriate tabs
  const tabs = await browser.tabs.query({ currentWindow: true });
  const windowId = (await browser.windows.getCurrent()).id;

  const showTabIds = [];
  const hideTabIds = [];
  const showTabs = [];

  await Promise.all(
    tabs.map(async (tab) => {
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
            console.log(
              `  Will hide tab ${tab.id} (${tab.title}) - groupId ${groupId} !== activeGroup ${activeGroup}`,
            );
            if (activeGroup === undefined) {
              console.warn(
                `    ⚠️ Hiding because ${groupId} !== undefined (always true!)`,
              );
            }
          }
        } else {
          showTabIds.push(tab.id);
          showTabs.push(tab);
          if (DEBUG) {
            console.log(
              `  Will show tab ${tab.id} (${tab.title}) - groupId ${groupId} === activeGroup ${activeGroup}`,
            );
          }
        }
      } catch {
        // The tab has probably been closed, this should be safe to ignore
      }
    }),
  );

  if (DEBUG) {
    const elapsed = Date.now() - toggleStartTime;
    console.log(
      `[ToggleVisibleTabs] Decision complete at +${elapsed}ms: ${hideTabIds.length} to hide, ${showTabIds.length} to show`,
    );
    if (showTabIds.length === 0 && hideTabIds.length > 0) {
      console.error(
        `[ToggleVisibleTabs] ERROR: No tabs will be shown! All ${hideTabIds.length} tabs will be hidden!`,
      );
      console.error(
        `[ToggleVisibleTabs] activeGroup=${activeGroup} - This should never happen after validation`,
      );
      return; // Abort instead of hiding all tabs
    }
  }

  if (noTabSelected) {
    showTabs.sort((tabA, tabB) => tabB.lastAccessed - tabA.lastAccessed);
    await browser.tabs.update(showTabs[0].id, { active: true });
  }

  // Get groups for native group management
  const groups = hasTabGroups ? await stateManager.getGroups(windowId) : null;

  // Step 1: Collapse and hide inactive groups
  if (hideTabIds.length > 0) {
    // Collapse native groups first (if available)
    const useNativeGroups = await shouldUseNativeGroups();
    if (useNativeGroups && groups) {
      await Promise.all(
        groups.map(async (group) => {
          if (group.nativeGroupId && group.id !== activeGroup) {
            try {
              await browser.tabGroups.update(group.nativeGroupId, {
                collapsed: true,
              });
            } catch (error) {
              // Group might not exist anymore, ignore
            }
          }
        }),
      );
    }

    // Then hide tabs (Firefox only)
    if (hasTabHide) {
      if (DEBUG) {
        const elapsed = Date.now() - toggleStartTime;
        console.log(
          `[ToggleVisibleTabs] About to hide ${hideTabIds.length} tabs at +${elapsed}ms`,
        );
      }
      await browser.tabs.hide(hideTabIds);
      if (DEBUG) {
        const elapsed = Date.now() - toggleStartTime;
        console.log(`[ToggleVisibleTabs] Hide complete at +${elapsed}ms`);
      }
    }
  }

  // Step 2: Show and uncollapse active group
  if (showTabIds.length > 0) {
    // Show tabs first (Firefox only)
    if (hasTabHide) {
      if (DEBUG) {
        const elapsed = Date.now() - toggleStartTime;
        console.log(
          `[ToggleVisibleTabs] About to show ${showTabIds.length} tabs at +${elapsed}ms`,
        );
      }
      await browser.tabs.show(showTabIds);
      if (DEBUG) {
        const elapsed = Date.now() - toggleStartTime;
        console.log(`[ToggleVisibleTabs] Show complete at +${elapsed}ms`);
      }
    }

    // Then uncollapse native group (if available)
    const useNativeGroups = await shouldUseNativeGroups();
    if (useNativeGroups && groups) {
      const activeGroupData = groups.find((g) => g.id === activeGroup);
      if (activeGroupData && activeGroupData.nativeGroupId) {
        try {
          await browser.tabGroups.update(activeGroupData.nativeGroupId, {
            collapsed: false,
          });
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

  if (DEBUG) {
    const elapsed = Date.now() - toggleStartTime;
    console.log(`[ToggleVisibleTabs] COMPLETE at +${elapsed}ms`);
  }
}

async function moveTab(tabId, groupId) {
  const windowId = (await browser.windows.getCurrent()).id;
  await stateManager.setTabGroup(tabId, groupId);

  // Also move tab to native browser group if available (but only for visible tabs)
  const useNativeGroups = await shouldUseNativeGroups();
  if (useNativeGroups) {
    try {
      const groups = await stateManager.getGroups(windowId);
      const targetGroup = groups.find((g) => g.id === parseInt(groupId, 10));
      const activeGroup = await stateManager.getActiveGroup(windowId);

      // Only assign to native group if this is the currently active group
      // This prevents conflicts with hidden tabs
      if (
        targetGroup &&
        targetGroup.nativeGroupId &&
        parseInt(groupId, 10) === activeGroup
      ) {
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
          const visibleTabs = await browser.tabs.query({ hidden: false });

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
  const extTabs = await browser.tabs.query({
    url: browser.runtime.getURL('view.html'),
    windowId,
  });

  if (extTabs.length > 0) {
    // Update tracked viewTabId
    windowState.viewTabId = extTabs[0].id;

    const currentTab = (
      await browser.tabs.query({ active: true, currentWindow: true })
    )[0];
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
  } else {
    // if there is no Panorama View tab, make one
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
    if (
      window.backgroundState.openingView?.creationTimestamp ===
      creationTimestamp
    ) {
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
  const isViewTabByWindow =
    window.backgroundState.openingView?.windowId === tab.windowId &&
    window.backgroundState.openingView?.creationTimestamp &&
    now - window.backgroundState.openingView.creationTimestamp < 100;
  // Wait for initialization to complete before processing tab creation
  await waitForInitialization();

  const isViewTabByUrl = tab.url === viewUrl || tab.pendingUrl === viewUrl;

  if (DEBUG) {
    console.log(
      `tabCreated: tab ${tab.id}, url="${tab.url}", pendingUrl="${tab.pendingUrl}", viewUrl="${viewUrl}", isViewTabById=${isViewTabById}, isViewTabByWindow=${isViewTabByWindow}, isViewTabByUrl=${isViewTabByUrl}`,
    );
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
    let activeGroup = await stateManager.getActiveGroup(tab.windowId);

    // Handle race condition: window created but activeGroup not set yet
    if (activeGroup === undefined || activeGroup === null) {
      console.log(
        `[TabCreated] activeGroup is ${activeGroup} for window ${tab.windowId}, using fallback`,
      );

      // Try to get lowest positive group ID from existing groups
      const groups = await stateManager.getGroups(tab.windowId);
      activeGroup = getLowestPositiveGroupId(groups);

      // If still no valid group, default to 0
      if (activeGroup === undefined) {
        activeGroup = 0;
      }

      await stateManager.setActiveGroup(tab.windowId, activeGroup);
    }

    await stateManager.setTabGroup(tab.id, activeGroup);
    tabGroupId = activeGroup;
    console.log(
      `[TabCreated] Tab ${tab.id} created in window ${tab.windowId}, assigned to group ${activeGroup}`,
    );
  } else if (DEBUG) {
    console.log(
      `[TabCreated] Tab ${tab.id} created in window ${tab.windowId}, already has group ${tabGroupId}`,
    );
  }

  // Assign to native browser group (do this regardless of whether groupId was already set)
  // This ensures tabs created by Group.addNewTab() get properly assigned to native groups
  let visibilityUpdated = false;
  const useNativeGroups = await shouldUseNativeGroups();
  if (useNativeGroups && tabGroupId !== -1) {
    try {
      const groups = await stateManager.getGroups(tab.windowId);
      const currentGroup = groups?.find((g) => g.id === tabGroupId);
      const activeGroup = await stateManager.getActiveGroup(tab.windowId);

      // If group doesn't have a native group yet, create one now
      if (currentGroup && !currentGroup.nativeGroupId) {
        // Get all tabs in this window and enrich with context
        const allTabs = await browser.tabs.query({ windowId: tab.windowId });
        const enrichedTabs = await Promise.all(
          allTabs.map((t) => enrichTabForGrouping(t)),
        );

        // Filter for tabs in this panorama group (excluding panorama view)
        const groupTabs = enrichedTabs.filter(
          (t) => t.panoramaGroupId === tabGroupId && !t.isPanoramaView,
        );

        if (DEBUG) {
          console.log(
            `[TabCreated] Found ${groupTabs.length} tabs for group ${tabGroupId} in window ${tab.windowId}`,
          );
        }

        if (groupTabs.length > 0) {
          // Validate and check safety
          const safetyCheck = await validateAndCheckSafety(
            groupTabs,
            tab.windowId,
            tabGroupId,
          );

          if (!safetyCheck.safe) {
            if (DEBUG) {
              console.log(
                `[TabCreated] Skipping native group creation: ${safetyCheck.reason}`,
              );
            }
            return;
          }

          if (DEBUG) {
            console.log(
              `[TabCreated] Creating native group for tab ${tab.id} in window ${tab.windowId}, grouping ${groupTabs.length} tabs:`,
              groupTabs.map((t) => t.tabId),
            );
          }

          // Verify window still exists before creating native group
          try {
            await browser.windows.get(tab.windowId);
          } catch (error) {
            console.warn(
              `[TabCreated] Window ${tab.windowId} was closed before creating native group for tab ${tab.id}`,
            );
            return;
          }

          // Create native group by grouping the tabs
          const nativeGroupId = await browser.tabs.group({
            tabIds: groupTabs.map((t) => t.tabId),
          });

          // Update the native group with title and color
          await browser.tabGroups.update(nativeGroupId, {
            title: currentGroup.name || `Group ${tabGroupId}`,
            color: getColorForGroupId(tabGroupId),
          });

          // Validate the native group was created in the correct window
          try {
            const createdGroup = await browser.tabGroups.get(nativeGroupId);
            if (createdGroup.windowId !== tab.windowId) {
              console.error(
                `[TabCreated] ❌ Window mismatch: created group ${nativeGroupId} in window ${createdGroup.windowId}, expected ${tab.windowId}`,
              );
              // Don't store this reference - it's in the wrong window
              return;
            }
          } catch (error) {
            console.error(
              `[TabCreated] Failed to validate native group:`,
              error,
            );
            return;
          }

          // Store the native group ID
          currentGroup.nativeGroupId = nativeGroupId;
          await stateManager.setGroups(tab.windowId, groups);

          if (DEBUG) {
            console.log(
              `[TabCreated] Created native group ${nativeGroupId} for panorama group ${tabGroupId} with ${groupTabs.length} tabs (from tabCreated)`,
            );
          }

          // Update visibility to hide panorama view tab since we now have an active tab in a group
          if (tab.active || tabGroupId === activeGroup) {
            if (DEBUG) {
              console.log(
                `Updating visibility for newly created native group (tab.active=${tab.active}, tabGroupId=${tabGroupId}, activeGroup=${activeGroup})`,
              );
            }
            await toggleVisibleTabs(tabGroupId);
            visibilityUpdated = true;
          }
        }
      } else if (
        currentGroup &&
        currentGroup.nativeGroupId &&
        tabGroupId === activeGroup
      ) {
        // Group has native group and is active, assign tab to it
        await browser.tabs.group({
          tabIds: [tab.id],
          groupId: currentGroup.nativeGroupId,
        });
        if (DEBUG) {
          console.log(
            `Assigned tab ${tab.id} to native group ${currentGroup.nativeGroupId} (panorama group ${tabGroupId})`,
          );
        }

        // Update visibility to hide panorama view tab since we now have an active tab in this group
        if (tab.active) {
          if (DEBUG) {
            console.log(
              `Updating visibility for existing native group (tab.active=${tab.active}, tabGroupId=${tabGroupId})`,
            );
          }
          await toggleVisibleTabs(tabGroupId);
          visibilityUpdated = true;
        }
      } else if (DEBUG) {
        console.log(
          `Skipped native group assignment for tab ${tab.id}: group inactive (will be grouped when activated)`,
        );
      }
    } catch (error) {
      // Native tabGroups might not be available
      console.warn('Could not assign new tab to native group:', error);
    }
  }

  // Update visibility if this is the active tab, regardless of native groups setting
  // This ensures the panorama view is hidden when a new tab becomes active
  // Only call if visibility wasn't already updated in the native groups block
  if (tab.active && tabGroupId !== -1 && !visibilityUpdated) {
    if (DEBUG) {
      console.log(
        `[TabCreated] Updating visibility for active tab ${tab.id} in group ${tabGroupId}`,
      );
    }
    await toggleVisibleTabs(tabGroupId);
  }
}

async function tabAttached(tabId, attachInfo) {
  // eslint-disable-line no-unused-vars
  // Wait for initialization to complete
  await waitForInitialization();

  const tab = await browser.tabs.get(tabId);
  await tabCreated(tab);
}

async function tabDetached(tabId, detachInfo) {
  // eslint-disable-line no-unused-vars
  await browser.sessions.removeTabValue(tabId, 'groupId');
}

/** Callback function which will be called whenever the user switches tabs.
 * This callback needed for properly switch between groups, when current tab
 * is from another group (or is Panorama Tab Groups tab).
 */
async function tabActivated(activeInfo) {
  // Wait for initialization to complete before processing tab activation
  await waitForInitialization();

  const startTime = Date.now();
  if (DEBUG) {
    console.log(
      `[TabActivated] START at ${startTime}: tabId=${activeInfo.tabId}`,
    );
  }

  const tab = await browser.tabs.get(activeInfo.tabId);

  if (tab.pinned) {
    return;
  }

  // Set the window's active group to the new active tab's group
  // If this is a newly-created tab, tabCreated() might not have set a
  // groupId yet, so retry until it does.
  const activeGroup = await stateManager.getTabGroup(activeInfo.tabId);

  if (DEBUG) {
    const elapsed = Date.now() - startTime;
    console.log(
      `[TabActivated] Active group determined at +${elapsed}ms: activeGroup=${activeGroup}`,
    );
    if (activeGroup === undefined) {
      console.warn(
        '[TabActivated] ⚠️ activeGroup is UNDEFINED - race condition detected!',
      );
      console.log(
        '[TabActivated] Skipping - tabCreated will handle visibility when group is assigned',
      );
    }
  }

  // Skip processing if activeGroup is undefined (race condition with tabCreated)
  // tabCreated will call toggleVisibleTabs once the group is properly assigned
  if (activeGroup === undefined) {
    return;
  }

  if (activeGroup !== -1) {
    // activated tab is not Panorama View tab
    if (DEBUG) {
      console.log(
        `[TabActivated] Entering activeGroup !== -1 block (activeGroup=${activeGroup})`,
      );
    }
    try {
      await stateManager.setActiveGroup(tab.windowId, activeGroup);
      if (DEBUG) {
        console.log('[TabActivated] setActiveGroup completed');
      }
    } catch (error) {
      console.error(
        `[TabActivated] ERROR in setActiveGroup(${tab.windowId}, ${activeGroup}):`,
        error,
      );
      if (DEBUG) {
        console.log(
          '[TabActivated] Continuing despite setActiveGroup error...',
        );
      }
    }

    // Create native tab group if needed (for groups created in panorama view)
    const useNativeGroups = await shouldUseNativeGroups();
    if (DEBUG) {
      console.log(
        `[TabActivated] shouldUseNativeGroups returned: ${useNativeGroups}`,
      );
    }
    if (useNativeGroups) {
      if (DEBUG) {
        console.log('[TabActivated] Entering useNativeGroups block');
      }
      const groups = await stateManager.getGroups(tab.windowId);
      const currentGroup = groups?.find((g) => g.id === activeGroup);
      if (DEBUG) {
        console.log(
          `[TabActivated] Found currentGroup: ${currentGroup?.name || 'none'}, querying tabGroups...`,
        );
      }

      // Check if the current tab already has a native group assignment
      const currentTabGroups = await browser.tabGroups.query({
        windowId: tab.windowId,
      });
      if (DEBUG) {
        console.log(
          `[TabActivated] tabGroups.query returned ${currentTabGroups.length} groups`,
        );
      }
      const tabsInNativeGroups = await Promise.all(
        currentTabGroups.map(async (ng) => {
          const tabs = await browser.tabs.query({ groupId: ng.id });
          return { nativeGroupId: ng.id, tabIds: tabs.map((t) => t.id) };
        }),
      );
      const existingNativeGroup = tabsInNativeGroups.find((ng) =>
        ng.tabIds.includes(tab.id),
      );

      // If this group doesn't have a native group yet AND the tab isn't in one, create it
      if (currentGroup && !currentGroup.nativeGroupId && !existingNativeGroup) {
        try {
          if (DEBUG) {
            console.log(
              `[TabActivated] Creating native group for tab ${tab.id} in window ${tab.windowId}, activeGroup=${activeGroup}`,
            );
          }

          // Get all tabs in this window and enrich with context
          const allTabs = await browser.tabs.query({ windowId: tab.windowId });
          const enrichedTabs = await Promise.all(
            allTabs.map((t) => enrichTabForGrouping(t)),
          );

          // Filter for tabs in this panorama group (excluding panorama view)
          const groupTabs = enrichedTabs.filter(
            (t) => t.panoramaGroupId === activeGroup && !t.isPanoramaView,
          );

          if (DEBUG) {
            console.log(
              `[TabActivated] Found ${groupTabs.length} tabs in group ${activeGroup} for window ${tab.windowId}:`,
              groupTabs.map((t) => t.tabId),
            );
          }

          if (groupTabs.length > 0) {
            // Validate and check safety
            const safetyCheck = await validateAndCheckSafety(
              groupTabs,
              tab.windowId,
              activeGroup,
            );

            if (!safetyCheck.safe) {
              if (DEBUG) {
                console.log(
                  `[TabActivated] Skipping native group creation: ${safetyCheck.reason}`,
                );
              }
              return;
            }

            // Verify window still exists before creating native group
            try {
              await browser.windows.get(tab.windowId);
            } catch (error) {
              console.warn(
                `[TabActivated] Window ${tab.windowId} was closed before creating native group`,
              );
              return;
            }

            // Create native group by grouping the tabs
            const nativeGroupId = await browser.tabs.group({
              tabIds: groupTabs.map((t) => t.tabId),
            });

            // Update the native group with title and color
            await browser.tabGroups.update(nativeGroupId, {
              title: currentGroup.name || `Group ${activeGroup}`,
              color: getColorForGroupId(activeGroup),
            });

            // Validate the native group was created in the correct window
            try {
              const createdGroup = await browser.tabGroups.get(nativeGroupId);
              if (createdGroup.windowId !== tab.windowId) {
                console.error(
                  `[TabActivated] ❌ Window mismatch: created group ${nativeGroupId} in window ${createdGroup.windowId}, expected ${tab.windowId}`,
                );
                // Don't store this reference - it's in the wrong window
                return;
              }
            } catch (error) {
              console.error(
                `[TabActivated] Failed to validate native group:`,
                error,
              );
              return;
            }

            // Store the native group ID
            currentGroup.nativeGroupId = nativeGroupId;
            await stateManager.setGroups(tab.windowId, groups);

            if (DEBUG) {
              console.log(
                `[TabActivated] Created native group ${nativeGroupId} for panorama group ${activeGroup} with ${groupTabs.length} tabs in window ${tab.windowId}`,
              );
            }
          } else {
            if (DEBUG) {
              console.log(
                `[TabActivated] No tabs found for group ${activeGroup} to create native group`,
              );
            }
          }
        } catch (error) {
          console.warn(
            `[TabActivated] Could not create native tab group in window ${tab.windowId}:`,
            error,
          );
        }
      } else if (
        currentGroup &&
        !currentGroup.nativeGroupId &&
        existingNativeGroup
      ) {
        // Tab is already in a native group, just store the reference
        currentGroup.nativeGroupId = existingNativeGroup.nativeGroupId;
        await stateManager.setGroups(tab.windowId, groups);
        if (DEBUG) {
          console.log(
            `Linked existing native group ${existingNativeGroup.nativeGroupId} to panorama group ${activeGroup}`,
          );
        }
      }
    } else if (DEBUG) {
      console.log('[TabActivated] Skipped useNativeGroups block (disabled)');
    }
  } else if (DEBUG) {
    console.log(
      '[TabActivated] Skipped activeGroup !== -1 block (panorama view tab)',
    );
  }

  if (DEBUG) {
    const elapsed = Date.now() - startTime;
    console.log(
      `[TabActivated] About to call toggleVisibleTabs at +${elapsed}ms with activeGroup=${activeGroup}`,
    );
  }

  await toggleVisibleTabs(activeGroup);

  if (DEBUG) {
    const elapsed = Date.now() - startTime;
    console.log(`[TabActivated] COMPLETE at +${elapsed}ms`);
  }
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

  const groups = [
    {
      id: groupId,
      name: `${browser.i18n.getMessage('defaultGroupName')}${groupId}`,
      containerId: 'browser-default',
      nativeGroupId, // Store reference to native group
      rect: {
        x: 0,
        y: 0,
        w: 0.5,
        h: 0.5,
      },
      lastMoved: new Date().getTime(),
    },
  ];

  // setGroups will automatically ensure Group -2 exists via StateManager
  await stateManager.setGroups(browserWindow.id, groups);

  // Use getLowestPositiveGroupId to select the first user group as active
  // (not Group -2 which is reserved for ungrouped tabs)
  const lowestPositiveId = getLowestPositiveGroupId(groups);
  const activeGroupId =
    lowestPositiveId !== undefined ? lowestPositiveId : groupId;

  await stateManager.setActiveGroup(browserWindow.id, activeGroupId);
}
/** Checks that group is missing before creating new one in window
 * This makes sure existing/restored windows are not reinitialized.
 * For example, windows that are restored by user (e.g. Ctrl+Shift+N) will
 * trigger the onCreated event but still have the existing group data.
 */
async function createGroupInWindowIfMissing(browserWindow) {
  // Wait for initialization to complete before creating groups
  await waitForInitialization();

  const groups = await stateManager.getGroups(browserWindow.id);

  if (!groups || !groups.length) {
    console.log(`No groups found for window ${browserWindow.id}!`);
    await createGroupInWindow(browserWindow);
  }
  browser.action.setTitle({
    title: 'Active Group: Unnamed group',
    windowId: browserWindow.id,
  });
  browser.action.setBadgeText({ text: '1', windowId: browserWindow.id });
  browser.action.setBadgeBackgroundColor({ color: '#666666' });
}
/** Make sure each window has a group */
async function setupWindows() {
  const windows = await browser.windows.getAll({});

  await Promise.all(
    windows.map(async (window) => {
      await createGroupInWindowIfMissing(window);
    }),
  );
}

/** Put any tabs that do not have a group into the active group */
async function salvageGrouplessTabs() {
  // make array of all groups for quick look-up
  const windows = {};
  const tWindows = await browser.windows.getAll({});

  // Use Promise.all to ensure all async operations complete
  await Promise.all(
    tWindows.map(async (window) => {
      windows[window.id] = { groups: null };
      windows[window.id].groups = await stateManager.getGroups(window.id);
    }),
  );

  // check all tabs
  const tabs = await browser.tabs.query({});

  await Promise.all(
    tabs.map(async (tab) => {
      const groupId = await stateManager.getTabGroup(tab.id);

      // Check if windows[tab.windowId] and its groups exist
      if (!windows[tab.windowId] || !windows[tab.windowId].groups) {
        console.log(
          `No groups found for window ${tab.windowId}, skipping tab ${tab.id}`,
        );
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
    }),
  );
}

/**
 * Migration Utility: Convert existing groups to hybrid system with native tab groups
 * This ensures existing users' groups get native tab group counterparts
 */

/**
 * Check if Firefox session history is available
 * Session history can be disabled by user privacy settings
 */
async function isSessionHistoryAvailable() {
  try {
    // Try to access session history API
    await browser.sessions.getRecentlyClosed({ maxResults: 1 });
    return true;
  } catch (error) {
    console.warn(
      '[Initialization] Session history not available:',
      error.message,
    );
    return false;
  }
}

/**
 * Show loading UI during initialization
 * Displays notification, badge, and sends message to panorama view
 */
async function showInitializationUI() {
  if (initializationState.showingUI) {
    return;
  }

  initializationState.showingUI = true;

  // Show browser notification
  browser.notifications.create('panorama-initializing', {
    type: 'basic',
    iconUrl: browser.runtime.getURL('icons/logo/logo-128.png'),
    title: 'Panorama Tab Groups',
    message: 'Restoring tab groups...',
  });

  // Set badge on extension icon
  browser.action.setBadgeText({ text: '...' });
  browser.action.setBadgeBackgroundColor({ color: '#FF9800' });

  // Send message to panorama view if open
  try {
    await browser.runtime.sendMessage({
      action: 'showInitializationLoading',
    });
  } catch (error) {
    // Panorama view not open, that's okay
  }

  if (DEBUG) {
    console.log('[Initialization] Loading UI displayed');
  }
}

/**
 * Hide loading UI after initialization completes
 */
async function hideInitializationUI() {
  if (!initializationState.showingUI) {
    return;
  }

  // Clear notification
  browser.notifications.clear('panorama-initializing');

  // Clear badge
  browser.action.setBadgeText({ text: '' });

  // Send message to panorama view if open
  try {
    await browser.runtime.sendMessage({
      action: 'hideInitializationLoading',
    });
  } catch (error) {
    // Panorama view not open, that's okay
  }

  initializationState.showingUI = false;

  if (DEBUG) {
    console.log('[Initialization] Loading UI hidden');
  }
}

/**
 * Attempt to recover tab's group from session history
 * @param {object} tab - Browser tab object
 * @returns {Promise<number|null>} Recovered group ID or null
 */
async function recoverGroupFromSessionHistory(tab) {
  try {
    // Try to get the tab's session value directly first
    const storedGroupId = await stateManager.getTabGroup(tab.id);
    if (
      storedGroupId !== null &&
      storedGroupId !== undefined &&
      !isNaN(storedGroupId)
    ) {
      return storedGroupId;
    }

    // If no stored value, tab is newly created or session was lost
    return null;
  } catch (error) {
    console.warn(
      `[Initialization] Could not recover group for tab ${tab.id}:`,
      error,
    );
    return null;
  }
}

/**
 * Initialize tab group assignments with session recovery
 * Blocks tab operations until complete or timeout
 */
async function initializeTabGroupAssignments() {
  initializationState.isInitializing = true;
  initializationState.startTime = Date.now();
  initializationState.recoveredTabs = 0;
  initializationState.assignedToUngrouped = 0;

  if (DEBUG) {
    console.log(
      '[Initialization] Starting tab group assignment recovery (max 10s)...',
    );
  }

  // Set up timeout for UI feedback
  const uiTimeout = setTimeout(() => {
    if (initializationState.isInitializing) {
      showInitializationUI();
    }
  }, SHOW_LOADING_UI_AFTER_MS);

  // Set up maximum timeout to unblock operations
  const maxTimeout = setTimeout(() => {
    if (initializationState.isInitializing) {
      console.warn(
        '[Initialization] Timeout reached (10s), unblocking operations',
      );
      initializationState.isInitializing = false;
    }
  }, INITIALIZATION_TIMEOUT_MS);

  try {
    // Check if session history is available
    const sessionAvailable = await isSessionHistoryAvailable();
    if (!sessionAvailable) {
      console.warn(
        '[Initialization] Session history disabled, all tabs will be assigned to ungrouped',
      );
    }

    // Get all windows and tabs
    const windows = await browser.windows.getAll({});

    for (const window of windows) {
      const groups = await stateManager.getGroups(window.id);
      if (!groups || groups.length === 0) {
        // Window has no groups yet, will be initialized by createGroupInWindowIfMissing
        continue;
      }

      // Ensure ungrouped group exists
      await stateManager.setGroups(window.id, groups);

      // Get all tabs in this window
      const tabs = await browser.tabs.query({ windowId: window.id });

      for (const tab of tabs) {
        let groupId = null;

        if (sessionAvailable) {
          // Try to recover from session history
          groupId = await recoverGroupFromSessionHistory(tab);
        }

        if (groupId !== null && groupId !== undefined && !isNaN(groupId)) {
          // Successfully recovered
          initializationState.recoveredTabs++;

          // Verify the group still exists
          const groupExists = groups.some((g) => g.id === groupId);
          if (!groupExists && !isReservedGroupId(groupId)) {
            // Group doesn't exist, assign to ungrouped
            if (DEBUG) {
              console.log(
                `[Initialization] Tab ${tab.id} group ${groupId} no longer exists, assigning to ungrouped`,
              );
            }
            groupId = UNGROUPED_GROUP_ID;
            initializationState.assignedToUngrouped++;
          }
        } else {
          // Could not recover, assign to ungrouped
          groupId = UNGROUPED_GROUP_ID;
          initializationState.assignedToUngrouped++;
        }

        // Store the assignment
        await stateManager.setTabGroup(tab.id, groupId);
      }

      if (DEBUG) {
        console.log(
          `[Initialization] Window ${window.id}: processed ${tabs.length} tabs`,
        );
      }
    }

    const duration = Date.now() - initializationState.startTime;
    console.log(
      `[Initialization] Complete in ${duration}ms: ${initializationState.recoveredTabs} recovered, ${initializationState.assignedToUngrouped} assigned to ungrouped`,
    );
  } catch (error) {
    console.error('[Initialization] Error during tab assignment:', error);
  } finally {
    // Clean up timeouts
    clearTimeout(uiTimeout);
    clearTimeout(maxTimeout);

    // Hide UI if showing
    if (initializationState.showingUI) {
      await hideInitializationUI();
    }

    // Mark initialization as complete
    initializationState.isInitializing = false;
  }
}

/**
 * Wait for initialization to complete (if in progress)
 * Used by event handlers to ensure they don't run before initialization finishes
 */
async function waitForInitialization() {
  if (!initializationState.isInitializing) {
    return;
  }

  const startWait = Date.now();
  const maxWait = INITIALIZATION_TIMEOUT_MS + 1000; // Extra 1 second buffer

  while (
    initializationState.isInitializing &&
    Date.now() - startWait < maxWait
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (initializationState.isInitializing) {
    console.warn('[Initialization] waitForInitialization timed out');
  }
}

async function init() {
  const options = await loadOptions();

  console.log('Initializing Panorama Tab View');

  // PHASE 1: Initialize tab-group assignments with blocking
  await initializeTabGroupAssignments();

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

  // Listen for useNativeGroups option changes
  browser.storage.onChanged.addListener(async (changes, areaName) => {
    if (DEBUG) {
      console.log(
        '[Storage] onChanged fired - areaName:',
        areaName,
        'changes:',
        changes,
      );
    }

    if (areaName === 'sync' && changes.useNativeGroups) {
      const { oldValue, newValue } = changes.useNativeGroups;

      if (DEBUG) {
        console.log(
          `[Storage] useNativeGroups changed: ${oldValue} -> ${newValue}`,
        );
      }

      // If native groups are being disabled, cleanup
      if (oldValue === true && newValue === false) {
        if (DEBUG) {
          console.log('[Storage] Native groups disabled, starting cleanup...');
        }
        try {
          await cleanupNativeGroups(DEBUG);
          if (DEBUG) {
            console.log('[Storage] Cleanup completed successfully');
          }
        } catch (error) {
          console.error('[Storage] Cleanup failed:', error);
        }
      }
    }
  });
};

/**
 * Delete a group with complete cleanup including native tab groups
 * Handles ungrouping tabs, removing tabs, updating storage, and removing menu items
 *
 * @param {Object} params - Deletion parameters
 * @param {number} params.groupId - ID of the group to delete
 * @param {number} params.windowId - Window ID containing the group
 * @param {number} params.nativeGroupId - Native group ID (if exists)
 * @param {Array<number>} params.tabIds - Array of tab IDs in the group
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function deleteGroupWithCleanup({
  groupId,
  windowId,
  nativeGroupId,
  tabIds,
}) {
  if (DEBUG) {
    console.log(
      `Deleting group ${groupId} with ${tabIds?.length || 0} tabs, nativeGroupId: ${nativeGroupId}`,
    );
  }

  try {
    // Step 1: Ungroup tabs from native group if applicable
    if (hasTabGroups && nativeGroupId !== undefined && nativeGroupId !== null) {
      try {
        // Verify tabs still exist and are in the native group before ungrouping
        const existingTabs = await browser.tabs.query({ windowId });
        const tabsToUngroup = tabIds.filter((id) =>
          existingTabs.some((t) => t.id === id && t.groupId === nativeGroupId),
        );

        if (tabsToUngroup.length > 0) {
          await browser.tabs.ungroup(tabsToUngroup);
          if (DEBUG) {
            console.log(
              `Ungrouped ${tabsToUngroup.length} tabs from native group ${nativeGroupId}`,
            );
          }
        }
      } catch (error) {
        // Native group may already be removed or tabs already ungrouped - this is OK
        if (DEBUG) {
          console.log(
            `Could not ungroup tabs (group may already be removed): ${error.message}`,
          );
        }
      }
    }

    // Step 2: Remove all tabs in the group
    if (tabIds && tabIds.length > 0) {
      await Promise.all(
        tabIds.map(async (id) => {
          try {
            await browser.tabs.remove(id);
          } catch (error) {
            // Tab may already be closed - this is OK
            if (DEBUG) {
              console.log(`Could not remove tab ${id}: ${error.message}`);
            }
          }
        }),
      );

      if (DEBUG) {
        console.log(`Removed ${tabIds.length} tabs from group ${groupId}`);
      }
    }

    // Step 3: Update storage to remove group
    const groups = await stateManager.getGroups(windowId);
    if (groups) {
      const leftGroups = groups.filter((g) => g.id !== groupId);
      await stateManager.setGroups(windowId, leftGroups);

      if (DEBUG) {
        console.log(`Updated storage: ${leftGroups.length} groups remaining`);
      }

      // If this was the last group, create a new initial group
      if (leftGroups.length === 0) {
        if (DEBUG) {
          console.log('Last group deleted, creating new initial group...');
        }
        await createGroupInWindow({ id: windowId });
      }
    }

    // Step 4: Remove menu item
    try {
      await browser.menus.remove(String(groupId));
      if (DEBUG) {
        console.log(`Removed menu item for group ${groupId}`);
      }
    } catch (error) {
      // Menu item may not exist - this is OK
      if (DEBUG) {
        console.log(`Could not remove menu item: ${error.message}`);
      }
    }

    return { success: true };
  } catch (error) {
    console.error(`Group deletion failed for group ${groupId}:`, error);
    return { success: false, error: error.message };
  }
}

// TODO: Remove? Is this used?
function handleMessage(message, sender) {
  // eslint-disable-line no-unused-vars
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
    case 'deleteGroup':
      // Handle complete group deletion with native cleanup
      deleteGroupWithCleanup(message)
        .then((response) => {
          sendResponse(response);
        })
        .catch((error) => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep message channel open for async response
    case 'cleanupNativeGroups':
      // Handle cleanup when native groups option is disabled
      if (DEBUG) {
        console.log('[Message] cleanupNativeGroups action received');
      }
      cleanupNativeGroups(DEBUG)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch((error) => {
          console.error('[Message] Cleanup failed:', error);
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep message channel open for async response
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
      migrateToHybridGroups(hasTabGroups, DEBUG)
        .then(() => {
          sendResponse({ success: true, message: 'Migration completed' });
        })
        .catch((error) => {
          sendResponse({ success: false, message: error.message });
        });
      return true; // Keep channel open for async response
    case 'resetMigration':
      // Reset migration flag for testing
      browser.storage.local
        .set({ hybridGroupsMigrationComplete: false })
        .then(() => {
          sendResponse({ success: true, message: 'Migration flag reset' });
        });
      return true;
    default:
      console.error(
        'Unknown internal message action:',
        message.action,
        message,
      );
      sendResponse({ error: `Unknown action: ${message.action}` });
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
