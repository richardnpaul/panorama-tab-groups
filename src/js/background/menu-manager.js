/**
 * Menu Manager - Context menu management for Panorama Tab Groups
 *
 * Handles creation, updating, and removal of context menu items
 * for sending tabs to different groups.
 */

import { stateManager } from './StateManager.js';

/**
 * Add refresh menu item to the end of the menu list
 * This ensures the refresh option is always at the bottom
 */
export async function addRefreshMenuItem() {
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

/**
 * Create the complete menu list with all groups
 * Called during initialization and when groups are refreshed
 */
export async function createMenuList() {
  try {
    await browser.menus.removeAll();

    // Get current window and its groups
    const currentWindow = await browser.windows.getCurrent();
    const groups = await stateManager.getGroups(currentWindow.id);

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
  } catch (error) {
    console.error('Failed to create menu list:', error);
  }
}

/**
 * Handle menu change messages from view
 * Responds to createMenuItem, removeMenuItem, and updateMenuItem actions
 *
 * @param {Object} message - Message object with action and menu item details
 * @returns {Promise<void>}
 */
export async function handleMenuChange(message) {
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
      try {
        await browser.menus.remove(String(message.groupId));
      } catch (error) {
        // Menu item may not exist - log warning but don't throw
        console.warn(`Could not remove menu item ${message.groupId}:`, error.message);
      }
      break;
    case 'updateMenuItem':
      browser.menus.update(String(message.groupId), { title: `${message.groupId}: ${message.groupName}` });
      break;
    default:
      break;
  }
}
