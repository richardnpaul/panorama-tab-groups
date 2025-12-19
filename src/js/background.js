import { loadOptions } from './_share/options.js';

const manifest = browser.runtime.getManifest();

window.backgroundState = {
  openingView: false,
  openingBackup: false,
};

window.viewRefreshOrdered = false;

/** Modulo in javascript does not behave like modulo in mathematics when x is negative.
 * Following code is based from this:
 * https://stackoverflow.com/questions/4467539/javascript-modulo-gives-a-negative-result-for-negative-numbers */
function mod(x, n) {
  return (((x % n) + n) % n);
}

async function addRefreshMenuItem() {
  // Safely remove existing menu items (ignore errors if they don't exist)
  try {
    await browser.menus.remove('refresh-groups');
  } catch (error) {
    // Ignore error if menu item doesn't exist
  }
  try {
    await browser.menus.remove('refresh-spacer');
  } catch (error) {
    // Ignore error if menu item doesn't exist
  }

  browser.menus.create({
    id: 'refresh-spacer',
    type: 'separator',
    parentId: 'send-tab',
    contexts: ['tab'],
  });
  browser.menus.create({
    id: 'refresh-groups',
    title: browser.i18n.getMessage('refreshGroups'),
    parentId: 'send-tab',
    contexts: ['tab'],
  });
}

async function createMenuList() {
  browser.menus.removeAll();

  // new menu for each group
  // for groups that have no tabs, make a disabled menu item

  // Get current window and its groups
  const currentWindow = await browser.windows.getCurrent();
  const groups = await browser.sessions.getWindowValue(currentWindow.id, 'groups');

  // Check if groups is initialized before proceeding
  if (!groups || !Array.isArray(groups)) {
    console.log('Groups not yet initialized, skipping menu creation');
    return;
  }

  groups.forEach((group) => {
    browser.menus.create({
      id: String(group.id),
      title: `${group.id}: ${group.name}`,
      parentId: 'send-tab',
      contexts: ['tab'],
    });
  });
  await addRefreshMenuItem();
}

createMenuList();

async function changeMenu(message) {
  switch (message.action) {
    case 'createMenuItem':
      browser.menus.create({
        id: String(message.groupId),
        title: `${message.groupId}: ${message.groupName}`,
        parentId: 'send-tab',
        contexts: ['tab'],
      });
      await addRefreshMenuItem(); // move refresh menu to end
      break;
    case 'removeMenuItem':
      browser.menus.remove(String(message.groupId));
      break;
    case 'updateMenuItem':
      browser.menus.update(String(message.groupId), { title: `${message.groupId}: ${message.groupName}` });
      break;
    default:
      break;
  }
}

browser.runtime.onMessage.addListener(changeMenu);

/** Set extension icon tooltip and numGroups to icon * */
async function setActionTitle(windowId, activeGroup = null) {
  let name;
  const groups = await browser.sessions.getWindowValue(windowId, 'groups');

  if (activeGroup === null) {
    activeGroup = await browser.sessions.getWindowValue(windowId, 'activeGroup');
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

/**
 * Get a color for a group based on its ID
 * Cycles through available colors
 */
function getColorForGroupId(groupId) {
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  return colors[groupId % colors.length];
}

async function toggleVisibleTabs(activeGroup, noTabSelected) {
  // Show and hide the appropriate tabs
  const tabs = await browser.tabs.query({ currentWindow: true });

  const showTabIds = [];
  const hideTabIds = [];
  const showTabs = [];

  await Promise.all(tabs.map(async (tab) => {
    try {
      const groupId = await browser.sessions.getTabValue(tab.id, 'groupId');

      if (groupId !== activeGroup) {
        hideTabIds.push(tab.id);
      } else {
        showTabIds.push(tab.id);
        showTabs.push(tab);
      }
    } catch {
      // The tab has probably been closed, this should be safe to ignore
    }
  }));

  if (noTabSelected) {
    showTabs.sort((tabA, tabB) => tabB.lastAccessed - tabA.lastAccessed);
    await browser.tabs.update(showTabs[0].id, { active: true });
  }

  await browser.tabs.hide(hideTabIds);
  await browser.tabs.show(showTabIds);

  if (activeGroup >= 0) {
    const window = await browser.windows.getLastFocused();
    await setActionTitle(window.id, activeGroup);
  }
}

async function moveTab(tabId, groupId) {
  const windowId = (await browser.windows.getCurrent()).id;
  await browser.sessions.setTabValue(tabId, 'groupId', parseInt(groupId, 10));

  // Also move tab to native browser group if available (but only for visible tabs)
  try {
    const groups = await browser.sessions.getWindowValue(windowId, 'groups');
    const targetGroup = groups.find((g) => g.id === parseInt(groupId, 10));
    const activeGroup = await browser.sessions.getWindowValue(windowId, 'activeGroup');

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
    // Native tabGroups might not be available
    console.warn('Could not assign tab to native group:', error);
  }

  const toIndex = -1;
  await browser.tabs.move(tabId, { index: toIndex });

  const activeGroup = (await browser.sessions.getWindowValue(windowId, 'activeGroup'));
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
  const groups = await browser.sessions.getWindowValue(windowId, 'groups');

  let activeGroup = (await browser.sessions.getWindowValue(windowId, 'activeGroup'));
  const activeIndex = groups.findIndex((group) => group.id === activeGroup);
  const newIndex = activeIndex + offset;

  activeGroup = groups[mod(newIndex, groups.length)].id;
  await browser.sessions.setWindowValue(windowId, 'activeGroup', activeGroup);

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
  const extTabs = await browser.tabs.query({ url: browser.runtime.getURL('view.html'), currentWindow: true });
  if (extTabs.length > 0) {
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
    window.backgroundState.openingView = true;
    await browser.tabs.create({ url: '/view.html', active: true });
  }
}

/** Callback function which will be called whenever a tab is opened */
async function tabCreated(tab) {
  if (window.backgroundState.openingBackup) {
    return;
  }

  if (!window.backgroundState.openingView) {
    // Normal case: everything except the Panorama View tab
    // If the tab does not have a group, set its group to the current group
    const tabGroupId = await browser.sessions.getTabValue(tab.id, 'groupId');
    if (tabGroupId === undefined) {
      const activeGroup = await browser.sessions.getWindowValue(tab.windowId, 'activeGroup');

      await browser.sessions.setTabValue(tab.id, 'groupId', activeGroup);

      // Only assign to native browser group if this is the active group
      // This prevents tabs from disappearing from panorama view
      try {
        const groups = await browser.sessions.getWindowValue(tab.windowId, 'groups');
        const currentGroup = groups.find((g) => g.id === activeGroup);

        // Only assign to native group for the currently active/visible group
        if (currentGroup && currentGroup.nativeGroupId) {
          // Check if this group is currently active (visible)
          const currentActiveGroup = await browser.sessions.getWindowValue(tab.windowId, 'activeGroup');
          if (activeGroup === currentActiveGroup) {
            await browser.tabs.group({
              tabIds: [tab.id],
              groupId: currentGroup.nativeGroupId,
            });
          }
          // For inactive groups, don't assign to native groups to prevent conflicts
        }
      } catch (error) {
        // Native tabGroups might not be available
        console.warn('Could not assign new tab to native group:', error);
      }
    }
  } else {
    // Opening the Panorama View tab
    // Make sure it's in the special group
    window.backgroundState.openingView = false;
    await browser.sessions.setTabValue(tab.id, 'groupId', -1);
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
  const activeGroup = await browser.sessions.getTabValue(activeInfo.tabId, 'groupId');

  if (activeGroup !== -1) {
    // activated tab is not Panorama View tab
    await browser.sessions.setWindowValue(tab.windowId, 'activeGroup', activeGroup);
  }

  await toggleVisibleTabs(activeGroup);
}

/** Get a new UID for a group */
async function newGroupUid(windowId) {
  const groupIndex = await browser.sessions.getWindowValue(windowId, 'groupIndex');

  const uid = groupIndex || 0;
  const newGroupIndex = uid + 1;

  await browser.sessions.setWindowValue(windowId, 'groupIndex', newGroupIndex);

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

  // Create native browser tab group
  let nativeGroupId = null;
  try {
    const nativeGroup = await browser.tabGroups.create({
      title: `${groupId}: ${browser.i18n.getMessage('defaultGroupName')}`,
      color: 'grey',
      windowId: browserWindow.id,
    });
    nativeGroupId = nativeGroup.id;
  } catch (error) {
    // TabGroups API might not be available in all browsers
    console.warn('Native tabGroups API not available:', error);
  }

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

  await browser.sessions.setWindowValue(browserWindow.id, 'groups', groups);
  await browser.sessions.setWindowValue(browserWindow.id, 'activeGroup', groupId);
}
/** Checks that group is missing before creating new one in window
 * This makes sure existing/restored windows are not reinitialized.
 * For example, windows that are restored by user (e.g. Ctrl+Shift+N) will
 * trigger the onCreated event but still have the existing group data.
 */
async function createGroupInWindowIfMissing(browserWindow) {
  const groups = await browser.sessions.getWindowValue(browserWindow.id, 'groups');

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
    windows[window.id].groups = await browser.sessions.getWindowValue(window.id, 'groups');
  }));

  // check all tabs
  const tabs = await browser.tabs.query({});

  await Promise.all(tabs.map(async (tab) => {
    const groupId = await browser.sessions.getTabValue(tab.id, 'groupId');

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
      const activeGroup = await browser.sessions.getWindowValue(tab.windowId, 'activeGroup');
      await browser.sessions.setTabValue(tab.id, 'groupId', activeGroup);
    }
  }));
}

/**
 * Migration Utility: Convert existing groups to hybrid system with native tab groups
 * This ensures existing users' groups get native tab group counterparts
 */
async function migrateToHybridGroups() {
  try {
    console.log('Starting migration to hybrid tab groups...');

    // Check if migration has already been done
    const migrationComplete = await browser.storage.local.get('hybridGroupsMigrationComplete');
    if (migrationComplete.hybridGroupsMigrationComplete) {
      console.log('Migration already completed, skipping...');
      return;
    }

    const windows = await browser.windows.getAll({});

    await Promise.all(windows.map(async (window) => {
      const groups = await browser.sessions.getWindowValue(window.id, 'groups');

      if (!groups || !Array.isArray(groups) || groups.length === 0) {
        console.log(`No groups to migrate for window ${window.id}`);
        return;
      }

      console.log(`Migrating ${groups.length} groups for window ${window.id}`);

      const updatedGroups = await Promise.all(groups.map(async (group) => {
        // Skip if already has a native group ID
        if (group.nativeGroupId !== undefined && group.nativeGroupId !== null) {
          console.log(`Group ${group.id} already has native group ${group.nativeGroupId}`);
          return group;
        }

        try {
          // Get all tabs for this group
          const tabs = await browser.tabs.query({ windowId: window.id });

          const groupTabIds = await Promise.all(tabs.map(async (tab) => {
            const tabGroupId = await browser.sessions.getTabValue(tab.id, 'groupId');
            if (tabGroupId === group.id) {
              return tab.id;
            }
            return null;
          }));

          const validTabIds = groupTabIds.filter((id) => id !== null);

          if (validTabIds.length === 0) {
            console.log(`Group ${group.id} has no tabs, skipping native group creation`);
            return group;
          }

          // Check if this is the active group
          const activeGroup = await browser.sessions.getWindowValue(window.id, 'activeGroup');

          // Only create native groups for the active group
          // Inactive groups will get native groups created when they become active
          if (group.id === activeGroup) {
            // Create native browser group by grouping tabs
            const groupId = await browser.tabs.group({
              tabIds: validTabIds,
            });

            console.log(`Created native group ${groupId} for active panorama group ${group.id} with ${validTabIds.length} tabs`);

            // Update the native group with title and color
            await browser.tabGroups.update(groupId, {
              title: group.name || `Group ${group.id}`,
              color: getColorForGroupId(group.id),
            });

            // Update group with native ID reference
            return {
              ...group,
              nativeGroupId: groupId,
            };
          }

          // For inactive groups, just mark as migrated without native group
          // The native group will be created when the group becomes active
          console.log(`Group ${group.id} is inactive, will create native group when activated`);
          return group;
        } catch (error) {
          console.warn(`Failed to create native group for group ${group.id}:`, error);
          // Keep the group without native ID if creation fails
          return group;
        }
      }));

      // Save updated groups back to session storage
      await browser.sessions.setWindowValue(window.id, 'groups', updatedGroups);
      console.log(`Migration complete for window ${window.id}`);
    }));

    // Mark migration as complete
    await browser.storage.local.set({ hybridGroupsMigrationComplete: true });
    console.log('Hybrid groups migration completed successfully!');
  } catch (error) {
    console.error('Migration to hybrid groups failed:', error);
    // Don't mark as complete so it can retry on next startup
  }
}

// Setup native browser tab group event listeners for hybrid functionality
function setupTabGroupListeners() {
  try {
    // When user creates group through browser UI
    browser.tabGroups.onCreated.addListener(async (group) => {
      console.log('Native tab group created:', group);
      // We could potentially sync this with our session storage if needed
    });

    // When user removes group through browser UI
    browser.tabGroups.onRemoved.addListener(async (group) => {
      console.log('Native tab group removed:', group);
      // Handle cleanup if our session storage references this group
      try {
        const groups = await browser.sessions.getWindowValue(group.windowId, 'groups');
        if (groups) {
          const updatedGroups = groups.filter((g) => g.nativeGroupId !== group.id);
          await browser.sessions.setWindowValue(group.windowId, 'groups', updatedGroups);
        }
      } catch (error) {
        console.warn('Error syncing removed native group:', error);
      }
    });

    // When user updates group through browser UI (name, color, etc.)
    browser.tabGroups.onUpdated.addListener(async (group) => {
      console.log('Native tab group updated:', group);
      // Sync name changes back to our session storage
      try {
        const groups = await browser.sessions.getWindowValue(group.windowId, 'groups');
        if (groups) {
          const updatedGroups = groups.map((g) => {
            if (g.nativeGroupId === group.id) {
              return { ...g, name: group.title };
            }
            return g;
          });
          await browser.sessions.setWindowValue(group.windowId, 'groups', updatedGroups);
        }
      } catch (error) {
        console.warn('Error syncing updated native group:', error);
      }
    });

    console.log('Native tab group listeners setup successfully');
  } catch (error) {
    console.warn('Native tabGroups API not available:', error);
  }
}

async function init() {
  const options = await loadOptions();

  console.log('Initializing Panorama Tab View');

  await setupWindows();
  await salvageGrouplessTabs();

  // Migrate existing groups to hybrid system with native tab groups
  await migrateToHybridGroups();

  console.log('Finished setup');

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

  // Add native tabGroups event listeners for hybrid functionality
  setupTabGroupListeners();
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
      migrateToHybridGroups().then(() => {
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
