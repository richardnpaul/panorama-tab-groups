/**
 * Native Groups Manager - Hybrid tab groups integration
 *
 * Manages integration between Panorama Tab Groups and browser native tab groups API.
 * Handles migration, synchronization, and event listening for native tab groups.
 */

import { stateManager } from './StateManager.js';
import { getColorForGroupId } from './utils.js';

/**
 * Helper: Enrich tab with full context (panorama group, window, native group)
 * @param {object} tab - Browser tab object
 * @returns {Promise<object>} Enriched tab with full context
 */
async function enrichTab(tab) {
  const panoramaGroupId = await stateManager.getTabGroup(tab.id);
  return {
    tabId: tab.id,
    windowId: tab.windowId,
    panoramaGroupId,
    isPanoramaView: panoramaGroupId === -1,
    nativeGroupId: tab.groupId !== -1 ? tab.groupId : null,
    title: tab.title,
  };
}

/**
 * Helper: Validate tabs can be safely grouped together
 * @param {Array<object>} enrichedTabs - Array of enriched tab objects
 * @throws {Error} If validation fails
 */
function validateTabsForGrouping(enrichedTabs) {
  if (!enrichedTabs || enrichedTabs.length === 0) {
    throw new Error('No tabs to group');
  }

  // All tabs must be in same window
  const windowIds = new Set(enrichedTabs.map((t) => t.windowId));
  if (windowIds.size > 1) {
    throw new Error(
      `Cross-window grouping attempted: tabs from windows ${[...windowIds].join(', ')}`,
    );
  }

  // All tabs must be in same panorama group
  const groupIds = new Set(enrichedTabs.map((t) => t.panoramaGroupId));
  if (groupIds.size > 1) {
    throw new Error(
      `Multiple panorama groups in single native group: ${[...groupIds].join(', ')}`,
    );
  }

  // No panorama view tabs should be grouped
  const hasPanoramaView = enrichedTabs.some((t) => t.isPanoramaView);
  if (hasPanoramaView) {
    throw new Error('Cannot group panorama view tabs');
  }

  return true;
}

/**
 * Helper: Check if grouping tabs would leave window in invalid state
 * Prevents window closure when grouping the only remaining tabs
 * @param {Array<object>} enrichedTabs - Tabs to be grouped
 * @param {number} windowId - Window ID
 * @param {boolean} DEBUG - Debug logging flag
 * @returns {Promise<boolean>} True if safe to group
 */
async function canSafelyGroupTabs(enrichedTabs, windowId, DEBUG) {
  try {
    // Check if window still exists
    try {
      await browser.windows.get(windowId);
    } catch (error) {
      if (DEBUG) {
        console.warn(`Window ${windowId} no longer exists, skipping grouping`);
      }
      return false;
    }

    // Get all tabs in the window
    const allWindowTabs = await browser.tabs.query({ windowId });
    const nonPanoramaTabs = allWindowTabs.filter((t) => {
      // Tab is non-panorama if it's not the view.html page
      const viewUrl = browser.runtime.getURL('view.html');
      return t.url !== viewUrl && t.pendingUrl !== viewUrl;
    });

    // If we're grouping ALL non-panorama tabs, window might close
    // This happens when grouping moves all regular tabs, leaving only panorama view
    // Browser will close such windows automatically
    if (
      enrichedTabs.length >= 1 &&
      enrichedTabs.length === nonPanoramaTabs.length
    ) {
      console.log(
        `[Safety Check] Skipping grouping: would group all ${enrichedTabs.length} regular tabs in window ${windowId}, which could cause window closure`,
      );
      console.log(
        `[Safety Check] enrichedTabs: ${enrichedTabs.map((t) => t.tabId).join(', ')}`,
      );
      console.log(
        `[Safety Check] nonPanoramaTabs: ${nonPanoramaTabs.map((t) => t.id).join(', ')}`,
      );
      return false;
    }

    // Additional safety: if no non-panorama tabs, don't attempt grouping
    if (nonPanoramaTabs.length === 0) {
      console.log(`[Safety Check] No non-panorama tabs in window ${windowId}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(
      `Error checking if tabs can be safely grouped in window ${windowId}:`,
      error,
    );
    return false;
  }
}

/**
 * Verify that native tab group IDs are correctly persisted in session storage
 * This runs after migration to ensure data integrity
 *
 * @param {boolean} hasTabGroups - Whether browser supports tabGroups API
 * @param {boolean} DEBUG - Debug flag for logging
 */
export async function verifyNativeGroupPersistence(hasTabGroups, DEBUG) {
  if (!hasTabGroups) {
    return;
  }

  try {
    if (DEBUG) {
      console.log('Verifying native group persistence...');
    }

    const windows = await browser.windows.getAll({});

    await Promise.all(
      windows.map(async (window) => {
        const groups = await stateManager.getGroups(window.id);

        if (!groups || !Array.isArray(groups)) {
          return;
        }

        await Promise.all(
          groups.map(async (group) => {
            if (
              group.nativeGroupId === undefined ||
              group.nativeGroupId === null
            ) {
              return;
            }

            try {
              // Try to get the native group to verify it still exists
              const nativeGroup = await browser.tabGroups.get(
                group.nativeGroupId,
              );
              if (DEBUG) {
                console.log(
                  `✓ Verified native group ${group.nativeGroupId} for panorama group ${group.id}`,
                );
              }

              // Verify the title matches
              if (nativeGroup.title !== group.name) {
                console.warn(
                  `Native group ${group.nativeGroupId} title mismatch: "${nativeGroup.title}" vs "${group.name}"`,
                );
              }
            } catch (error) {
              console.error(
                `✗ Native group ${group.nativeGroupId} not found for panorama group ${group.id}:`,
                error,
              );

              // Clean up the broken reference
              const updatedGroups = groups.map((g) => {
                if (g.id === group.id) {
                  return { ...g, nativeGroupId: null };
                }
                return g;
              });
              await stateManager.setGroups(window.id, updatedGroups);
              console.log(
                `Cleaned up broken native group reference for group ${group.id}`,
              );
            }
          }),
        );
      }),
    );

    if (DEBUG) {
      console.log('Native group persistence verification complete');
    }
  } catch (error) {
    console.error('Failed to verify native group persistence:', error);
  }
}

/**
 * Migrate groups for a single window
 * @param {number} windowId - Window ID to migrate
 * @param {Object} stateMgr - State manager instance
 * @param {boolean} DEBUG - Debug logging flag
 */
async function migrateWindowGroups(windowId, stateMgr, DEBUG) {
  const groups = await stateMgr.getGroups(windowId);

  if (DEBUG) {
    console.log(
      `[Migration] Retrieved groups for window ${windowId}:`,
      groups?.map((g) => ({
        id: g.id,
        name: g.name,
        hasNativeGroupId: g.nativeGroupId !== undefined,
      })),
    );
    const activeGroup = await stateMgr.getActiveGroup(windowId);
    console.log(`[Migration] Current activeGroup: ${activeGroup}`);

    // Log validation statistics
    const withNativeId = groups.filter((g) => g.nativeGroupId != null).length;
    console.log(
      `[Migration] ${groups.length} total groups, ${withNativeId} have nativeGroupId (will validate)`,
    );
  }

  if (!groups || !Array.isArray(groups) || groups.length === 0) {
    console.log(`No groups to migrate for window ${windowId}`);
    return;
  }

  if (DEBUG) {
    console.log(`Migrating ${groups.length} groups for window ${windowId}`);
  }

  const updatedGroups = await Promise.all(
    groups.map(async (group) => {
      // Validate existing nativeGroupId before skipping migration
      if (group.nativeGroupId !== undefined && group.nativeGroupId !== null) {
        try {
          // Verify the native group actually exists
          await browser.tabGroups.get(group.nativeGroupId);
          if (DEBUG) {
            console.log(
              `Group ${group.id} has valid native group ${group.nativeGroupId}, skipping`,
            );
          }
          return group; // Valid native group, skip migration
        } catch (error) {
          // Native group doesn't exist - stale reference from race condition or previous error
          if (DEBUG) {
            console.warn(
              `Group ${group.id} has stale nativeGroupId ${group.nativeGroupId} (${error.message}), will recreate`,
            );
          }
          // Clear stale reference and fall through to migration logic below
          delete group.nativeGroupId;
        }
      }

      try {
        if (DEBUG) {
          console.log(
            `[Migration] Processing group ${group.id} (${group.name}) in window ${windowId}`,
          );
        }

        // Get all tabs for this group and enrich with full context
        const tabs = await browser.tabs.query({ windowId });

        if (DEBUG) {
          console.log(
            `[Migration] Query found ${tabs.length} tabs in window ${windowId}`,
          );
        }

        // Enrich tabs with panorama group ID and other context
        const enrichedTabs = await Promise.all(
          tabs.map((tab) => enrichTab(tab)),
        );

        // Filter for tabs belonging to this group in this window (excluding panorama view)
        const groupTabs = enrichedTabs.filter(
          (t) =>
            t.panoramaGroupId === group.id &&
            t.windowId === windowId &&
            !t.isPanoramaView,
        );

        if (DEBUG && groupTabs.length > 0) {
          console.log(
            `[Migration] Group ${group.id} has ${groupTabs.length} tabs:`,
            groupTabs.map((t) => t.tabId),
          );
          console.log(
            `[Migration] Tab details:`,
            groupTabs.map((t) => ({
              tabId: t.tabId,
              windowId: t.windowId,
              panoramaGroupId: t.panoramaGroupId,
              title: t.title,
            })),
          );
        }

        if (groupTabs.length === 0) {
          if (DEBUG) {
            console.log(
              `Group ${group.id} has no tabs, skipping native group creation`,
            );
          }
          return group;
        }

        // Check if this is the active group
        const activeGroup = await stateMgr.getActiveGroup(windowId);

        // Only create native groups for the active group
        // Inactive groups will get native groups created when they become active
        if (group.id === activeGroup) {
          // Safety check: can we safely group these tabs?
          const isSafeToGroup = await canSafelyGroupTabs(
            groupTabs,
            windowId,
            DEBUG,
          );

          if (!isSafeToGroup) {
            if (DEBUG) {
              console.warn(
                `[Migration] Skipping group ${group.id} - not safe to group (single tab scenario or window closed)`,
              );
            }
            return group;
          }

          // Validate tabs before grouping
          try {
            validateTabsForGrouping(groupTabs);
          } catch (error) {
            console.error(
              `[Migration] Validation failed for group ${group.id}:`,
              error.message,
            );
            return group;
          }

          // Re-validate window still exists before attempting to create native group
          // Window may have closed due to previous group migration
          try {
            await browser.windows.get(windowId);
          } catch (error) {
            console.warn(
              `[Migration] Window ${windowId} closed during migration, skipping group ${group.id}`,
            );
            console.warn('[Migration] Error:', error.message);
            return group; // Stop processing this group
          }

          // Create native browser group by grouping tabs
          const groupId = await browser.tabs.group({
            tabIds: groupTabs.map((t) => t.tabId),
          });

          if (DEBUG) {
            console.log(
              `Created native group ${groupId} for active panorama group ${group.id} with ${groupTabs.length} tabs`,
            );
          }

          // Validate native group was created in correct window
          try {
            const createdGroup = await browser.tabGroups.get(groupId);
            if (createdGroup.windowId !== windowId) {
              console.error(
                `[Migration] ❌ NATIVE GROUP WINDOW MISMATCH: Expected window ${windowId} but native group ${groupId} is in window ${createdGroup.windowId}`,
              );
              console.error(
                `[Migration] This indicates the browser closed window ${windowId} and moved tabs to window ${createdGroup.windowId}`,
              );

              // Remove the incorrectly placed native group
              try {
                await browser.tabs.ungroup(groupTabs.map((t) => t.tabId));
                console.log(
                  `[Migration] Ungrouped tabs to prevent orphaned native group`,
                );
              } catch (ungroupError) {
                console.error(
                  '[Migration] Failed to ungroup tabs:',
                  ungroupError,
                );
              }

              // Try to remove from storage since window no longer exists
              try {
                await browser.sessions.removeWindowValue(windowId, 'groups');
                await browser.sessions.removeWindowValue(
                  windowId,
                  'activeGroup',
                );
              } catch (cleanupError) {
                // Ignore cleanup errors - window already gone
              }

              // Don't store this native group ID since it's in the wrong window
              return group;
            }

            if (DEBUG) {
              console.log(
                `[Migration] ✓ Native group ${groupId} correctly created in window ${windowId}`,
              );
            }
          } catch (e) {
            console.error(
              `[Migration] Failed to validate native group ${groupId}:`,
              e,
            );
            return group;
          }

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
        if (DEBUG) {
          console.log(
            `Group ${group.id} is inactive, will create native group when activated`,
          );
        }
        return group;
      } catch (error) {
        console.warn(
          `Failed to create native group for group ${group.id}:`,
          error,
        );
        // Keep the group without native ID if creation fails
        return group;
      }
    }),
  );

  // Save updated groups back to session storage
  await stateMgr.setGroups(windowId, updatedGroups);
  if (DEBUG) {
    const migratedCount = updatedGroups.filter(
      (g) => g.nativeGroupId != null,
    ).length;
    console.log(
      `[Migration] Complete for window ${windowId}: ${migratedCount}/${updatedGroups.length} groups have native groups`,
    );
  }
}

/**
 * Migrate existing groups to hybrid system with native tab groups
 * This ensures existing users' groups get native tab group counterparts
 *
 * @param {boolean} hasTabGroups - Whether browser supports tabGroups API
 * @param {boolean} DEBUG - Debug flag for logging
 */
export async function migrateToHybridGroups(hasTabGroups, DEBUG) {
  // Skip migration if browser doesn't support tabGroups API
  if (!hasTabGroups) {
    console.log('Browser does not support tabGroups API, skipping migration');
    return;
  }

  try {
    if (DEBUG) {
      console.log('Starting migration to hybrid tab groups...');
    }

    // Check if migration has already been done
    const migrationComplete = await browser.storage.local.get(
      'hybridGroupsMigrationComplete',
    );
    if (migrationComplete.hybridGroupsMigrationComplete) {
      if (DEBUG) {
        console.log('⚠️ Migration already complete flag is TRUE, skipping...');
        console.log(
          'This should only happen on subsequent extension loads, not after cleanup',
        );
      }
      return;
    }

    const windows = await browser.windows.getAll({});

    await Promise.all(
      windows.map(async (browserWindow, index) => {
        if (DEBUG) {
          console.log(
            `[Migration] Processing window ${index + 1}/${windows.length} (ID: ${browserWindow.id})`,
          );
        }

        await migrateWindowGroups(browserWindow.id, stateManager, DEBUG);
      }),
    );

    // Mark migration as complete
    await browser.storage.local.set({ hybridGroupsMigrationComplete: true });
    if (DEBUG) {
      console.log('Hybrid groups migration completed successfully!');
    }

    // Verify persistence after migration
    await verifyNativeGroupPersistence(hasTabGroups, DEBUG);
  } catch (error) {
    console.error('Migration to hybrid groups failed:', error);
    // Don't mark as complete so it can retry on next startup
  }
}

// Flag to suppress event handlers during cleanup operations
let isCleanupInProgress = false;

/**
 * Setup native browser tab group event listeners for hybrid functionality
 * Listens for native group creation, removal, and updates to keep sync
 *
 * @param {boolean} hasTabGroups - Whether browser supports tabGroups API
 * @param {boolean} DEBUG - Debug flag for logging
 */
export function setupTabGroupListeners(hasTabGroups, DEBUG) {
  // Only setup listeners if tabGroups API is available
  if (!hasTabGroups) {
    console.log(
      'Browser does not support tabGroups API, skipping listener setup',
    );
    return;
  }

  try {
    // When user creates group through browser UI
    browser.tabGroups.onCreated.addListener(async (group) => {
      console.log('Native tab group created:', group);
      // We could potentially sync this with our session storage if needed
    });

    // When user removes group through browser UI
    browser.tabGroups.onRemoved.addListener(async (group) => {
      // Ignore events during cleanup - we're intentionally removing native groups
      if (isCleanupInProgress) {
        if (DEBUG) {
          console.log(
            `Native tab group removed (ignored during cleanup): ${group.id}`,
          );
        }
        return;
      }

      console.log('Native tab group removed:', group);
      // Clear nativeGroupId from panorama group but keep the group itself
      try {
        const groups = await stateManager.getGroups(group.windowId);
        if (groups) {
          const updatedGroups = groups.map((g) => {
            if (g.nativeGroupId === group.id) {
              // Remove nativeGroupId property but keep the group
              const { nativeGroupId, ...groupWithoutNativeId } = g;
              console.log(
                `Cleared nativeGroupId ${group.id} from panorama group ${g.id} (${g.name})`,
              );
              return groupWithoutNativeId;
            }
            return g;
          });
          await stateManager.setGroups(group.windowId, updatedGroups);
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
        const groups = await stateManager.getGroups(group.windowId);
        if (groups) {
          const updatedGroups = groups.map((g) => {
            if (g.nativeGroupId === group.id) {
              return { ...g, name: group.title };
            }
            return g;
          });
          await stateManager.setGroups(group.windowId, updatedGroups);
        }
      } catch (error) {
        console.warn('Error syncing updated native group:', error);
      }
    });

    if (DEBUG) {
      console.log('Native tab group listeners setup successfully');
    }
  } catch (error) {
    console.warn('Native tabGroups API not available:', error);
  }
}

/**
 * Cleanup all native tab groups when feature is disabled
 * Ungroups all tabs while preserving the Panorama Tab Groups data
 *
 * @param {boolean} DEBUG - Debug flag for logging
 */
export async function cleanupNativeGroups(DEBUG) {
  if (DEBUG) {
    console.log('Starting native groups cleanup...');
  }

  // Set flag to suppress event handlers during cleanup
  isCleanupInProgress = true;

  try {
    const windows = await browser.windows.getAll({});

    await Promise.all(
      windows.map(async (window) => {
        const groups = await stateManager.getGroups(window.id);

        if (DEBUG) {
          console.log(
            `[Cleanup] Retrieved ${groups?.length || 0} groups for window ${window.id}:`,
            groups?.map((g) => ({
              id: g.id,
              name: g.name,
              nativeGroupId: g.nativeGroupId,
            })),
          );
        }

        if (!groups || !Array.isArray(groups)) {
          return;
        }

        if (DEBUG) {
          console.log(`Cleaning up native groups for window ${window.id}`);
        }

        // Get ALL tabs in this window that are in any native group
        try {
          const allTabs = await browser.tabs.query({ windowId: window.id });
          // Filter for tabs that are in a native group (groupId !== -1)
          const allTabsInGroups = allTabs.filter(
            (tab) => tab.groupId && tab.groupId !== -1,
          );

          if (allTabsInGroups.length > 0) {
            const tabIds = allTabsInGroups.map((t) => t.id);
            await browser.tabs.ungroup(tabIds);

            if (DEBUG) {
              console.log(
                `Ungrouped ${tabIds.length} tabs from native groups in window ${window.id}`,
              );
            }
          } else if (DEBUG) {
            console.log(
              `No tabs in native groups found for window ${window.id}`,
            );
          }
        } catch (error) {
          console.warn(`Failed to ungroup tabs in window ${window.id}:`, error);
        }

        // Clear nativeGroupId references from Panorama groups
        const updatedGroups = groups.map((group) => {
          if (
            group.nativeGroupId !== undefined &&
            group.nativeGroupId !== null
          ) {
            if (DEBUG) {
              console.log(
                `Clearing nativeGroupId ${group.nativeGroupId} from panorama group ${group.id}`,
              );
            }
            // Return new object without nativeGroupId
            const { nativeGroupId, ...groupWithoutNativeId } = group;
            return groupWithoutNativeId;
          }
          return group;
        });

        await stateManager.setGroups(window.id, updatedGroups);

        if (DEBUG) {
          console.log(
            `[Cleanup] Saved ${updatedGroups.length} updated groups for window ${window.id}:`,
            updatedGroups.map((g) => ({ id: g.id, name: g.name })),
          );

          // Verify cleanup actually worked
          const verification = await stateManager.getGroups(window.id);
          const stillHasNativeIds = verification.filter(
            (g) => g.nativeGroupId != null,
          );
          if (stillHasNativeIds.length > 0) {
            console.warn(
              `[Cleanup] ⚠️ Race condition detected! ${stillHasNativeIds.length} groups still have nativeGroupId:`,
              stillHasNativeIds.map((g) => `Group ${g.id}: ${g.nativeGroupId}`),
            );
          } else {
            console.log(
              `[Cleanup] ✓ Verification passed: all nativeGroupIds removed`,
            );
          }
        }
      }),
    );

    // Reset migration flag so re-enabling native groups will trigger fresh migration
    await browser.storage.local.set({ hybridGroupsMigrationComplete: false });

    if (DEBUG) {
      console.log('Native groups cleanup completed successfully!');
    }
  } catch (error) {
    console.error('Native groups cleanup failed:', error);
    throw error; // Re-throw to allow error handling in caller
  } finally {
    // Always clear the flag, even if cleanup fails
    isCleanupInProgress = false;
    if (DEBUG) {
      console.log('Cleanup flag cleared');
    }
  }
}
