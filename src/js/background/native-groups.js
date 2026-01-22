/**
 * Native Groups Manager - Hybrid tab groups integration
 *
 * Manages integration between Panorama Tab Groups and browser native tab groups API.
 * Handles migration, synchronization, and event listening for native tab groups.
 */

import { stateManager } from './StateManager.js';
import { getColorForGroupId } from './utils.js';

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
      console.log('Migration already completed, skipping...');
      return;
    }

    const windows = await browser.windows.getAll({});

    await Promise.all(
      windows.map(async (window) => {
        const groups = await stateManager.getGroups(window.id);

        if (!groups || !Array.isArray(groups) || groups.length === 0) {
          console.log(`No groups to migrate for window ${window.id}`);
          return;
        }

        if (DEBUG) {
          console.log(
            `Migrating ${groups.length} groups for window ${window.id}`,
          );
        }

        const updatedGroups = await Promise.all(
          groups.map(async (group) => {
            // Skip if already has a native group ID
            if (
              group.nativeGroupId !== undefined &&
              group.nativeGroupId !== null
            ) {
              if (DEBUG) {
                console.log(
                  `Group ${group.id} already has native group ${group.nativeGroupId}`,
                );
              }
              return group;
            }

            try {
              // Get all tabs for this group
              const tabs = await browser.tabs.query({ windowId: window.id });

              const groupTabIds = await Promise.all(
                tabs.map(async (tab) => {
                  const tabGroupId = await stateManager.getTabGroup(tab.id);
                  if (tabGroupId === group.id) {
                    return tab.id;
                  }
                  return null;
                }),
              );

              const validTabIds = groupTabIds.filter((id) => id !== null);

              if (validTabIds.length === 0) {
                if (DEBUG) {
                  console.log(
                    `Group ${group.id} has no tabs, skipping native group creation`,
                  );
                }
                return group;
              }

              // Check if this is the active group
              const activeGroup = await stateManager.getActiveGroup(window.id);

              // Only create native groups for the active group
              // Inactive groups will get native groups created when they become active
              if (group.id === activeGroup) {
                // Create native browser group by grouping tabs
                const groupId = await browser.tabs.group({
                  tabIds: validTabIds,
                });

                if (DEBUG) {
                  console.log(
                    `Created native group ${groupId} for active panorama group ${group.id} with ${validTabIds.length} tabs`,
                  );
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
        await stateManager.setGroups(window.id, updatedGroups);
        if (DEBUG) {
          console.log(`Migration complete for window ${window.id}`);
        }
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
      console.log('Native tab group removed:', group);
      // Handle cleanup if our session storage references this group
      try {
        const groups = await stateManager.getGroups(group.windowId);
        if (groups) {
          const updatedGroups = groups.filter(
            (g) => g.nativeGroupId !== group.id,
          );
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

  try {
    const windows = await browser.windows.getAll({});

    await Promise.all(
      windows.map(async (window) => {
        const groups = await stateManager.getGroups(window.id);

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
      }),
    );

    if (DEBUG) {
      console.log('Native groups cleanup completed successfully!');
    }
  } catch (error) {
    console.error('Native groups cleanup failed:', error);
    throw error; // Re-throw to allow error handling in caller
  }
}
