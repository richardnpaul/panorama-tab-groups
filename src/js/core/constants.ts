/**
 * Constants for Tab Groups Viewer
 * Reserved group IDs and other application-wide constants
 */

/**
 * Reserved Group IDs
 * Negative IDs are reserved for special purposes and should never be user-created
 */
export const VIEWER_GROUP_ID = -1; // viewer tab itself
export const UNGROUPED_GROUP_ID = -2; // Tabs not belonging to any group

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
 * Automatic backups (docs/plans/data-structures-review.md, decision 7)
 */
// The folder under the user's Downloads folder they are written to
export const AUTO_BACKUP_FOLDER = 'panorama-tab-groups-backups';
// How many are kept: the files are numbered 1 to this, and written in turn
export const AUTO_BACKUP_COUNT = 5;
// A change is backed up only if the last backup is at least this old
export const AUTO_BACKUP_INTERVAL_MS = 60 * 60 * 1000; // an hour
// How long a backup file may take to be written before the backup is given up on, so that one
// download that never ends does not hold up the ones after it, or the start-up
export const AUTO_BACKUP_WRITE_MS = 30000;
// How long the groups have to stay unchanged before a backup is written. Short: a background that
// nothing happens to is stopped after about 30 seconds, and its timers with it
export const AUTO_BACKUP_QUIET_MS = 5000;

/**
 * What is kept of windows that closed, so that one that comes back (a session restored, a closed
 * window reopened) gets its groups again: the most recent windows, none for longer than this.
 * Chromium gives the window new ids when it comes back, so what was kept is found by its groups.
 */
export const CLOSED_WINDOWS_KEPT = 5;
export const CLOSED_WINDOW_KEPT_MS = 7 * 24 * 60 * 60 * 1000; // a week

/**
 * Check if a group ID is a reserved system group
 */
export function isReservedGroupId(groupId: unknown): boolean {
  return groupId === VIEWER_GROUP_ID || groupId === UNGROUPED_GROUP_ID;
}

/**
 * Check if a group ID is valid for user-created groups
 */
export function isValidUserGroupId(groupId: unknown): boolean {
  return typeof groupId === 'number' && groupId >= 0;
}

// Chromium refuses to change a tab group while the user drags a tab, which is when a group's name
// field loses focus; how often, and how many times, the title is asked for again
export const NATIVE_GROUP_EDIT_RETRY_MS = 200;
export const NATIVE_GROUP_EDIT_TRIES = 25;
