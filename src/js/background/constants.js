/**
 * Constants for Panorama Tab Groups
 * Reserved group IDs and other application-wide constants
 */

/**
 * Reserved Group IDs
 * Negative IDs are reserved for special purposes and should never be user-created
 */
export const PANORAMA_VIEW_GROUP_ID = -1; // Panorama view tab itself
export const UNGROUPED_GROUP_ID = -2; // Tabs not belonging to any panorama group

/**
 * Special group name constants
 * These names are immutable and enforced by the system
 */
export const UNGROUPED_GROUP_NAME = 'Ungrouped Tabs';

/**
 * Initialization constants
 */
export const INITIALIZATION_TIMEOUT_MS = 10000; // 10 seconds
export const SHOW_LOADING_UI_AFTER_MS = 1000; // Show loading UI after 1 second

/**
 * Check if a group ID is a reserved system group
 */
export function isReservedGroupId(groupId) {
  return groupId === PANORAMA_VIEW_GROUP_ID || groupId === UNGROUPED_GROUP_ID;
}

/**
 * Check if a group ID is valid for user-created groups
 */
export function isValidUserGroupId(groupId) {
  return typeof groupId === 'number' && groupId >= 0;
}
