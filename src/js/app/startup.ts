import type { Logger } from '../ports/logger.js';
import type { FirstRun } from './first-run.js';
import type { MenuManager } from './menu-manager.js';
import type { GroupRecovery } from './group-recovery.js';
import type { NativeGroupsSync } from './native-groups-sync.js';
import type { ViewRefresh } from './view-refresh.js';
import type { WindowGroups } from './window-groups.js';

export interface StartupDeps {
  firstRun: Pick<FirstRun, 'decideNativeGroups'>;
  recovery: Pick<
    GroupRecovery,
    'initializeTabGroupAssignments' | 'salvageGrouplessTabs'
  >;
  windowGroups: Pick<WindowGroups, 'setupWindows'>;
  nativeGroupsSync: Pick<NativeGroupsSync, 'migrate' | 'relink'>;
  menuManager: Pick<MenuManager, 'createMenuList'>;
  viewRefresh: Pick<ViewRefresh, 'applyPopup'>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  logger: Pick<Logger, 'debug'>;
}

/** Get the extension going: recover the groups of the tabs, then everything built on them */
export function createStartup({
  firstRun,
  recovery,
  windowGroups,
  nativeGroupsSync,
  menuManager,
  viewRefresh,
  useNativeGroups,
  logger,
}: StartupDeps): () => Promise<void> {
  return async function init() {
    logger.debug('Initializing Tab Groups Viewer');

    // Before anything makes groups, so that what is there is what the decision looks at
    await firstRun.decideNativeGroups();

    // Events wait for this, so it comes first
    await recovery.initializeTabGroupAssignments();

    await windowGroups.setupWindows();
    await recovery.salvageGrouplessTabs();

    // Existing users' groups get native tab groups, if they want them
    if (await useNativeGroups()) {
      // The native groups may have new ids, if the browser started again
      await nativeGroupsSync.relink();
      await nativeGroupsSync.migrate();
    }

    // The menu is made after the groups it lists are settled
    await menuManager.createMenuList();
    await viewRefresh.applyPopup();
    logger.debug('Finished setup');
  };
}
