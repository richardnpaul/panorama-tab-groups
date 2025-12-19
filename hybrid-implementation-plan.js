// Hybrid TabGroups + Hide/Show Implementation Plan
// This combines native browser tab groups with Firefox's hide/show functionality

/**
 * HYBRID APPROACH BENEFITS:
 * 1. Native browser groups provide visual organization in tab bar
 * 2. Hide/show functionality manages which group is actually visible
 * 3. Better metadata management through native API
 * 4. Users can see group structure even when tabs are hidden
 * 5. Maintains Firefox-specific hide/show superpower
 */

class HybridGroupManager {
  constructor() {
    this.activeGroupId = null;
    this.groupVisibilityMap = new Map(); // Track which groups should be visible
  }

  /**
   * Create a new hybrid group
   * 1. Create native browser group
   * 2. Set up hide/show tracking
   * 3. Assign tabs to both systems
   */
  async createGroup(options = {}) {
    // Create native browser group for visual organization
    const nativeGroup = await browser.tabGroups.create({
      title: options.title || 'New Group',
      color: options.color || 'grey',
      windowId: options.windowId || browser.windows.WINDOW_ID_CURRENT,
    });

    // Set up our hide/show tracking
    this.groupVisibilityMap.set(nativeGroup.id, false); // Start hidden

    // Store additional metadata if needed
    await browser.storage.local.set({
      [`group_${nativeGroup.id}_metadata`]: {
        created: Date.now(),
        customSettings: options.customSettings || {},
      },
    });

    return nativeGroup;
  }

  /**
   * Add tabs to a hybrid group
   * 1. Add to native browser group (visual)
   * 2. Set up hide/show behavior
   */
  async addTabsToGroup(tabIds, groupId) {
    // Add to native browser group for visual organization
    await browser.tabs.group({
      tabIds,
      groupId,
    });

    // If this group is not the active one, hide these tabs
    if (this.activeGroupId !== groupId) {
      await browser.tabs.hide(tabIds);
    }
  }

  /**
   * Switch active group (core hide/show functionality)
   * 1. Hide all tabs from previously active group
   * 2. Show all tabs from newly active group
   * 3. Update active group tracking
   */
  async switchToGroup(groupId) {
    // Get all tabs in current window
    const allTabs = await browser.tabs.query({ currentWindow: true });

    const showTabIds = [];
    const hideTabIds = [];

    // Categorize tabs based on group membership
    allTabs.forEach((tab) => {
      if (tab.groupId === groupId) {
        showTabIds.push(tab.id);
      } else if (tab.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
        // Only hide tabs that belong to other groups, leave ungrouped tabs visible
        hideTabIds.push(tab.id);
      }
    });

    // Perform the hide/show operations
    if (hideTabIds.length > 0) {
      await browser.tabs.hide(hideTabIds);
    }
    if (showTabIds.length > 0) {
      await browser.tabs.show(showTabIds);

      // Activate the most recently used tab in the group
      const sortedTabs = showTabIds
        .map((id) => allTabs.find((tab) => tab.id === id))
        .sort((a, b) => b.lastAccessed - a.lastAccessed);

      if (sortedTabs.length > 0) {
        await browser.tabs.update(sortedTabs[0].id, { active: true });
      }
    }

    // Update tracking
    this.activeGroupId = groupId;
    this.groupVisibilityMap.set(groupId, true);

    // Hide other groups in our tracking
    Array.from(this.groupVisibilityMap.keys()).forEach((gId) => {
      if (gId !== groupId) {
        this.groupVisibilityMap.set(gId, false);
      }
    });

    // Update extension badge/title
    await HybridGroupManager.updateExtensionUI(groupId);
  }

  /**
   * Update extension UI to reflect current state
   */
  static async updateExtensionUI(activeGroupId) {
    const groups = await browser.tabGroups.query({
      windowId: browser.windows.WINDOW_ID_CURRENT,
    });

    const activeGroup = groups.find((g) => g.id === activeGroupId);
    const title = activeGroup ? `Active: ${activeGroup.title}` : 'No Active Group';

    await browser.action.setTitle({ title });
    await browser.action.setBadgeText({ text: String(groups.length) });
    await browser.action.setBadgeBackgroundColor({ color: '#666666' });
  }

  /**
   * Handle native browser group events
   * Sync with our hide/show system
   */
  setupEventListeners() {
    // When user creates group through browser UI
    browser.tabGroups.onCreated.addListener(async (group) => {
      this.groupVisibilityMap.set(group.id, false);
      // If tabs were added to this group, handle visibility
      const groupTabs = await browser.tabs.query({ groupId: group.id });
      if (group.id !== this.activeGroupId && groupTabs.length > 0) {
        await browser.tabs.hide(groupTabs.map((tab) => tab.id));
      }
    });

    // When user removes group through browser UI
    browser.tabGroups.onRemoved.addListener(async (group) => {
      this.groupVisibilityMap.delete(group.id);
      // Show any tabs that were in this group
      const ungroupedTabs = await browser.tabs.query({
        groupId: browser.tabGroups.TAB_GROUP_ID_NONE,
      });
      await browser.tabs.show(ungroupedTabs.map((tab) => tab.id));
    });

    // When tabs are moved between groups
    browser.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
      if (changeInfo.groupId !== undefined) {
        // Tab moved to/from a group
        if (changeInfo.groupId === this.activeGroupId) {
          // Moved to active group - show it
          await browser.tabs.show([tabId]);
        } else if (changeInfo.groupId !== browser.tabGroups.TAB_GROUP_ID_NONE) {
          // Moved to inactive group - hide it
          await browser.tabs.hide([tabId]);
        }
      }
    });
  }
}

// Usage example in background script:
const groupManager = new HybridGroupManager();
groupManager.setupEventListeners();

// Commands for switching groups
browser.commands.onCommand.addListener(async (command) => {
  if (command === 'activate-next-group') {
    const groups = await browser.tabGroups.query({
      windowId: browser.windows.WINDOW_ID_CURRENT,
    });
    // Find next group and switch to it
    const currentIndex = groups.findIndex((g) => g.id === groupManager.activeGroupId);
    const nextIndex = (currentIndex + 1) % groups.length;
    await groupManager.switchToGroup(groups[nextIndex].id);
  }
});
