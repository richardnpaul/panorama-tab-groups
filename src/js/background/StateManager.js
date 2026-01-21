/**
 * StateManager - Centralized state management for Panorama Tab Groups
 *
 * Abstracts browser.sessions API and browser.storage.local API to provide
 * a unified interface for state management. This handles MV3 service worker
 * lifecycle where in-memory state can be lost on termination.
 *
 * State Storage Strategy:
 * - browser.sessions.* - Per-window/tab state (ephemeral, fast access)
 * - browser.storage.local - Extension-level state (persistent across restarts)
 *
 * Session storage is used for:
 * - groups (per-window)
 * - activeGroup (per-window)
 * - groupId (per-tab)
 * - groupIndex (per-window)
 *
 * Local storage is used for:
 * - backgroundState (openingView, openingBackup)
 * - windowStates (viewTabId per window)
 */

export class StateManager {
  constructor() {
    // Cache for reducing redundant storage reads
    this.cache = new Map();
    this.cacheTimeout = 100; // ms
  }

  // ==================== Session Storage (Per-Window/Tab) ====================

  /**
   * Get groups for a specific window
   * @param {number} windowId - The window ID
   * @returns {Promise<Array>} Array of group objects
   */
  async getGroups(windowId) {
    return browser.sessions.getWindowValue(windowId, 'groups');
  }

  /**
   * Set groups for a specific window
   * @param {number} windowId - The window ID
   * @param {Array} groups - Array of group objects
   */
  async setGroups(windowId, groups) {
    await browser.sessions.setWindowValue(windowId, 'groups', groups);
    this.invalidateCache(`groups_${windowId}`);
  }

  /**
   * Get active group ID for a specific window
   * @param {number} windowId - The window ID
   * @returns {Promise<number>} Active group ID
   */
  async getActiveGroup(windowId) {
    return browser.sessions.getWindowValue(windowId, 'activeGroup');
  }

  /**
   * Set active group for a specific window
   * @param {number} windowId - The window ID
   * @param {number} groupId - The group ID to set as active
   */
  async setActiveGroup(windowId, groupId) {
    console.log(`[StateManager] setActiveGroup called: windowId=${windowId}, groupId=${groupId}`);
    try {
      await browser.sessions.setWindowValue(windowId, 'activeGroup', groupId);
      console.log('[StateManager] setWindowValue completed successfully');
      this.invalidateCache(`activeGroup_${windowId}`);
      console.log('[StateManager] setActiveGroup complete');
    } catch (error) {
      console.error(`[StateManager] ERROR in setWindowValue(${windowId}, 'activeGroup', ${groupId}):`, error);
      throw error;
    }
  }

  /**
   * Get group index for a specific window
   * @param {number} windowId - The window ID
   * @returns {Promise<number>} Group index
   */
  async getGroupIndex(windowId) {
    return browser.sessions.getWindowValue(windowId, 'groupIndex');
  }

  /**
   * Set group index for a specific window
   * @param {number} windowId - The window ID
   * @param {number} index - The group index
   */
  async setGroupIndex(windowId, index) {
    await browser.sessions.setWindowValue(windowId, 'groupIndex', index);
    this.invalidateCache(`groupIndex_${windowId}`);
  }

  /**
   * Get group ID for a specific tab
   * @param {number} tabId - The tab ID
   * @returns {Promise<number>} Group ID the tab belongs to
   */
  async getTabGroup(tabId) {
    return browser.sessions.getTabValue(tabId, 'groupId');
  }

  /**
   * Set group ID for a specific tab
   * @param {number} tabId - The tab ID
   * @param {number} groupId - The group ID
   */
  async setTabGroup(tabId, groupId) {
    await browser.sessions.setTabValue(tabId, 'groupId', parseInt(groupId, 10));
    this.invalidateCache(`tabGroup_${tabId}`);
  }

  /**
   * Get multiple tab groups in parallel
   * @param {Array<number>} tabIds - Array of tab IDs
   * @returns {Promise<Array<number>>} Array of group IDs
   */
  async getTabGroups(tabIds) {
    return Promise.all(
      tabIds.map((tabId) => browser.sessions.getTabValue(tabId, 'groupId')),
    );
  }

  // ==================== Local Storage (Extension-Level) ====================

  /**
   * Get background state (persistent across service worker restarts)
   * @returns {Promise<Object>} Background state object
   */
  async getBackgroundState() {
    const cacheKey = 'backgroundState';
    const cached = this.getFromCache(cacheKey);
    if (cached !== undefined) return cached;

    const result = await browser.storage.local.get('backgroundState');
    const state = result.backgroundState || {
      openingView: null,
      openingBackup: false,
    };

    this.setCache(cacheKey, state);
    return state;
  }

  /**
   * Set background state
   * @param {Object} state - Background state object
   */
  async setBackgroundState(state) {
    await browser.storage.local.set({ backgroundState: state });
    this.invalidateCache('backgroundState');
  }

  /**
   * Update specific background state properties
   * @param {Object} updates - Properties to update
   */
  async updateBackgroundState(updates) {
    const currentState = await this.getBackgroundState();
    const newState = { ...currentState, ...updates };
    await this.setBackgroundState(newState);
  }

  /**
   * Get window state for a specific window
   * @param {number} windowId - The window ID
   * @returns {Promise<Object>} Window state object
   */
  async getWindowState(windowId) {
    const cacheKey = `windowState_${windowId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached !== undefined) return cached;

    const result = await browser.storage.local.get('windowStates');
    const windowStates = result.windowStates || {};
    const state = windowStates[windowId] || { viewTabId: null };

    this.setCache(cacheKey, state);
    return state;
  }

  /**
   * Set window state for a specific window
   * @param {number} windowId - The window ID
   * @param {Object} state - Window state object
   */
  async setWindowState(windowId, state) {
    const result = await browser.storage.local.get('windowStates');
    const windowStates = result.windowStates || {};
    windowStates[windowId] = state;
    await browser.storage.local.set({ windowStates });
    this.invalidateCache(`windowState_${windowId}`);
  }

  /**
   * Remove window state for a specific window (cleanup)
   * @param {number} windowId - The window ID
   */
  async removeWindowState(windowId) {
    const result = await browser.storage.local.get('windowStates');
    const windowStates = result.windowStates || {};
    delete windowStates[windowId];
    await browser.storage.local.set({ windowStates });
    this.invalidateCache(`windowState_${windowId}`);
  }

  // ==================== Batch Operations ====================

  /**
   * Get both groups and active group for a window in one call
   * @param {number} windowId - The window ID
   * @returns {Promise<{groups: Array, activeGroup: number}>}
   */
  async getWindowGroupState(windowId) {
    const [groups, activeGroup] = await Promise.all([
      this.getGroups(windowId),
      this.getActiveGroup(windowId),
    ]);
    return { groups, activeGroup };
  }

  /**
   * Set both groups and active group for a window in one call
   * @param {number} windowId - The window ID
   * @param {Array} groups - Array of group objects
   * @param {number} activeGroup - Active group ID
   */
  async setWindowGroupState(windowId, groups, activeGroup) {
    await Promise.all([
      this.setGroups(windowId, groups),
      this.setActiveGroup(windowId, activeGroup),
    ]);
  }

  // ==================== Cache Management ====================

  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.value;
    }
    return undefined;
  }

  setCache(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  invalidateCache(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cached values
   */
  clearCache() {
    this.cache.clear();
  }

  // ==================== Migration Helpers ====================

  /**
   * Migrate window.backgroundState to storage.local
   * @param {Object} legacyState - The legacy window.backgroundState object
   */
  async migrateBackgroundState(legacyState) {
    if (legacyState) {
      await this.setBackgroundState(legacyState);
    }
  }

  /**
   * Migrate window.windowStates Map to storage.local
   * @param {Map} legacyStates - The legacy window.windowStates Map
   */
  async migrateWindowStates(legacyStates) {
    if (legacyStates && legacyStates.size > 0) {
      const windowStates = {};
      for (const [windowId, state] of legacyStates) {
        windowStates[windowId] = state;
      }
      await browser.storage.local.set({ windowStates });
    }
  }
}

// Create singleton instance
export const stateManager = new StateManager();
