import type { Logger } from '../ports/logger.js';
import type { AutoBackup } from './auto-backup.js';
import type { ClosedWindows } from './closed-windows.js';
import type { FirstRun } from './first-run.js';
import type { MenuManager } from './menu-manager.js';
import type { Migrations } from './migrations.js';
import type { GroupRecovery } from './group-recovery.js';
import type { NativeGroupsSync } from './native-groups-sync.js';
import type { ViewRefresh } from './view-refresh.js';
import type { WindowRebuild } from './window-rebuild.js';
import type { WindowGroups } from './window-groups.js';

export interface StartupDeps {
  migrations: Pick<Migrations, 'atStart'>;
  firstRun: Pick<FirstRun, 'decideNativeGroups'>;
  windowRebuild: Pick<WindowRebuild, 'rebuildAll'>;
  closedWindows: Pick<ClosedWindows, 'prune'>;
  recovery: Pick<
    GroupRecovery,
    'initializeTabGroupAssignments' | 'salvageGrouplessTabs'
  >;
  windowGroups: Pick<WindowGroups, 'setupWindows'>;
  nativeGroupsSync: Pick<NativeGroupsSync, 'migrate' | 'relink'>;
  menuManager: Pick<MenuManager, 'createMenuList'>;
  viewRefresh: Pick<ViewRefresh, 'applyPopup'>;
  autoBackup: Pick<AutoBackup, 'start'>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  logger: Pick<Logger, 'debug'>;
}

/** Get the extension going: recover the groups of the tabs, then everything built on them */
export function createStartup({
  migrations,
  firstRun,
  windowRebuild,
  closedWindows,
  recovery,
  windowGroups,
  nativeGroupsSync,
  menuManager,
  viewRefresh,
  autoBackup,
  useNativeGroups,
  logger,
}: StartupDeps): () => Promise<void> {
  return async function init() {
    logger.debug('Initializing Tab Groups Viewer');

    // Before anything changes the tabs, so that what is there is what the decision looks at:
    // the migrations show hidden tabs where native groups are on. It reads nothing stored.
    await firstRun.decideNativeGroups();

    // Before anything reads what is stored: a backup of it as it was, then it is brought up
    await migrations.atStart();

    // Windows that come back with native groups and none of ours (Chromium gives every tab and
    // window a new id) get their groups from them, before events are let through
    await windowRebuild.rebuildAll();

    // Events wait for this, so it comes first
    await recovery.initializeTabGroupAssignments();

    await windowGroups.setupWindows();
    await recovery.salvageGrouplessTabs();

    // What the windows and tabs of before have no more use for is let go of, and what is kept of
    // the windows that are not back is dated from now
    await closedWindows.prune();

    // Existing users' groups get native tab groups, if they want them
    if (await useNativeGroups()) {
      // The native groups may have new ids, if the browser started again
      await nativeGroupsSync.relink();
      await nativeGroupsSync.migrate();
    }

    // The menu is made after the groups it lists are settled
    await menuManager.createMenuList();
    await viewRefresh.applyPopup();
    // Only now: what start-up found may have been a loss it has since repaired
    autoBackup.start();
    logger.debug('Finished setup');
  };
}
