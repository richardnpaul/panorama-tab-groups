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

import { UNGROUPED_GROUP_ID, UNGROUPED_GROUP_NAME } from './constants.js';

/* eslint-disable class-methods-use-this */

export class StateManager {
  // ==================== Session Storage (Per-Window/Tab) ====================

  /**
   * Get groups for a specific window
   * @param {number} windowId - The window ID
   * @returns {Promise<Array>} Array of group objects
   */
  async getGroups(windowId) {
    const DEBUG = true;
    if (DEBUG) {
      console.debug(`[StateManager] getGroups called for window ${windowId}`);
    }
    const groups = await browser.sessions.getWindowValue(windowId, 'groups');
    if (DEBUG) {
      console.debug(
        `[StateManager] getGroups returning ${groups?.length || 0} groups for window ${windowId}`,
      );
    }
    return groups;
  }

  /**
   * Set groups for a specific window
   * @param {number} windowId - The window ID
   * @param {Array} groups - Array of group objects
   */
  async setGroups(windowId, groups) {
    const DEBUG = true;
    if (DEBUG) {
      // Log call stack to identify concurrent callers
      const stack = new Error().stack
        .split('\n')
        .slice(2, 4)
        .map((line) => line.trim())
        .join(' -> ');
      console.debug(
        `[StateManager] setGroups called for window ${windowId} with ${groups?.length || 0} groups`,
      );
      console.debug(`  Caller: ${stack}`);

      // Log groups with nativeGroupId for tracking
      const withNative =
        groups?.filter((g) => g.nativeGroupId != null).length || 0;
      if (withNative > 0) {
        console.debug(`  ${withNative} groups have nativeGroupId`);
      }
    }

    // Ensure group -2 always exists
    if (!groups) {
      groups = [];
    }

    const hasUngroupedGroup = groups.some((g) => g.id === UNGROUPED_GROUP_ID);

    if (!hasUngroupedGroup) {
      groups.push({
        id: UNGROUPED_GROUP_ID,
        name: UNGROUPED_GROUP_NAME,
        containerId: 'browser-default',
        nativeGroupId: null, // Never has native group
        rect: { x: 0, y: 0, w: 0, h: 0 }, // No position in grid
        lastMoved: new Date().getTime(),
        isSystemGroup: true, // Mark as system-managed
      });
    } else {
      const ungroupedIndex = groups.findIndex(
        (g) => g.id === UNGROUPED_GROUP_ID,
      );
      if (ungroupedIndex !== -1) {
        groups[ungroupedIndex].name = UNGROUPED_GROUP_NAME;
        groups[ungroupedIndex].isSystemGroup = true;
        groups[ungroupedIndex].nativeGroupId = null;
      }
    }

    await browser.sessions.setWindowValue(windowId, 'groups', groups);
  }

  /**
   * Get active group ID for a specific window
   * @param {number} windowId - The window ID
   * @returns {Promise<number>} Active group ID
   */
  async getActiveGroup(windowId) {
    const activeGroup = await browser.sessions.getWindowValue(
      windowId,
      'activeGroup',
    );

    // Return undefined without fallback - caller should handle
    // This allows callers to detect uninitialized windows
    if (activeGroup === undefined || activeGroup === null) {
      console.debug(
        `[StateManager] getActiveGroup: No activeGroup set for window ${windowId}`,
      );
    }

    return activeGroup;
  }

  /**
   * Set active group for a specific window
   * @param {number} windowId - The window ID
   * @param {number} groupId - The group ID to set as active
   */
  async setActiveGroup(windowId, groupId) {
    console.debug(
      `[StateManager] setActiveGroup called: windowId=${windowId}, groupId=${groupId}`,
    );
    try {
      await browser.sessions.setWindowValue(windowId, 'activeGroup', groupId);
      console.debug('[StateManager] setWindowValue completed successfully');
      console.debug('[StateManager] setActiveGroup complete');
    } catch (error) {
      console.error(
        `[StateManager] ERROR in setWindowValue(${windowId}, 'activeGroup', ${groupId}):`,
        error,
      );
      throw error;
    }
  }

  /**
   * Get group index for a specific window
   * @param {number} windowId - The window ID
   * @returns {Promise<number>} Group index
   */
  async getGroupIndex(windowId) {
    const groupIndex = await browser.sessions.getWindowValue(
      windowId,
      'groupIndex',
    );
    return groupIndex;
  }

  /**
   * Set group index for a specific window
   * @param {number} windowId - The window ID
   * @param {number} index - The group index
   */
  async setGroupIndex(windowId, index) {
    await browser.sessions.setWindowValue(windowId, 'groupIndex', index);
  }

  /**
   * Get group ID for a specific tab
   * @param {number} tabId - The tab ID
   * @returns {Promise<number>} Group ID the tab belongs to
   */
  async getTabGroup(tabId) {
    const groupId = await browser.sessions.getTabValue(tabId, 'groupId');
    return groupId;
  }

  /**
   * Set group ID for a specific tab
   * @param {number} tabId - The tab ID
   * @param {number} groupId - The group ID
   */
  async setTabGroup(tabId, groupId) {
    await browser.sessions.setTabValue(tabId, 'groupId', parseInt(groupId, 10));
  }

  /**
   * Get multiple tab groups in parallel
   * @param {Array<number>} tabIds - Array of tab IDs
   * @returns {Promise<Array<number>>} Array of group IDs
   */
  async getTabGroups(tabIds) {
    return Promise.all(tabIds.map((tabId) => this.getTabGroup(tabId)));
  }

  // ==================== Local Storage (Extension-Level) ====================

  /**
   * Get background state (persistent across service worker restarts)
   * @returns {Promise<Object>} Background state object
   */
  async getBackgroundState() {
    const result = await browser.storage.local.get('backgroundState');
    const state = result.backgroundState || {
      openingView: null,
      openingBackup: false,
    };

    return state;
  }

  /**
   * Set background state
   * @param {Object} state - Background state object
   */
  async setBackgroundState(state) {
    await browser.storage.local.set({ backgroundState: state });
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
    const result = await browser.storage.local.get('windowStates');
    const windowStates = result.windowStates || {};
    const state = windowStates[windowId] || { viewTabId: null };

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
