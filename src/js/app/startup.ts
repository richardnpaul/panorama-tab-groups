import type { Logger } from '../ports/logger.js';
import type { MenuManager } from './menu-manager.js';
import type { GroupRecovery } from './group-recovery.js';
import type { NativeGroupsSync } from './native-groups-sync.js';
import type { ViewRefresh } from './view-refresh.js';
import type { WindowGroups } from './window-groups.js';

export interface StartupDeps {
  recovery: Pick<
    GroupRecovery,
    'initializeTabGroupAssignments' | 'salvageGrouplessTabs'
  >;
  windowGroups: Pick<WindowGroups, 'setupWindows'>;
  nativeGroupsSync: Pick<NativeGroupsSync, 'migrate'>;
  menuManager: Pick<MenuManager, 'createMenuList'>;
  viewRefresh: Pick<ViewRefresh, 'applyPopup'>;
  // Whether the browser has native tab groups at all
  hasTabGroups: boolean;
  logger: Pick<Logger, 'debug'>;
}

/** Get the extension going: recover the groups of the tabs, then everything built on them */
export function createStartup({
  recovery,
  windowGroups,
  nativeGroupsSync,
  menuManager,
  viewRefresh,
  hasTabGroups,
  logger,
}: StartupDeps): () => Promise<void> {
  return async function init() {
    logger.debug('Initializing Panorama Tab View');

    // Events wait for this, so it comes first
    await recovery.initializeTabGroupAssignments();

    await windowGroups.setupWindows();
    await recovery.salvageGrouplessTabs();

    // Existing users' groups get native tab groups
    if (hasTabGroups) {
      await nativeGroupsSync.migrate();
    }

    // The menu is made after the groups it lists are settled
    await menuManager.createMenuList();
    await viewRefresh.applyPopup();
    logger.debug('Finished setup');
  };
}
