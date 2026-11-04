import {
  createBrowserBackupFiles,
  textLinksOf,
} from '../adapters/browser/backup-files.js';
import { createBrowserBackupLog } from '../adapters/browser/backup-log.js';
import { createBrowserDataVersion } from '../adapters/browser/data-version.js';
import { createBrowserPendingUpdate } from '../adapters/browser/pending-update.js';
import { createBrowserExtension } from '../adapters/browser/extension.js';
import { createBrowserI18n } from '../adapters/browser/i18n.js';
import { createBrowserMenus } from '../adapters/browser/menus.js';
import { createBrowserMessaging } from '../adapters/browser/messaging.js';
import { createBrowserMigrationFlag } from '../adapters/browser/migration-flag.js';
import { createBrowserNativeGroups } from '../adapters/browser/native-groups.js';
import { createBrowserNotifications } from '../adapters/browser/notifications.js';
import { createBrowserOptions } from '../adapters/browser/options.js';
import { createBrowserSessionHistory } from '../adapters/browser/session-history.js';
import { createBrowserTabs } from '../adapters/browser/tabs.js';
import { createBrowserToolbar } from '../adapters/browser/toolbar.js';
import { createBrowserWindows } from '../adapters/browser/windows.js';
import type { BackgroundHandlers } from '../adapters/browser/events.js';
import { systemClock } from '../adapters/system/clock.js';
import { createSystemScheduler } from '../adapters/system/scheduler.js';
import { createAddonUpdate } from '../app/addon-update.js';
import { createAutoBackup, withBackupOnChange } from '../app/auto-backup.js';
import { createBackupSnapshot } from '../app/backup-service.js';
import { createBrowserEvents } from '../app/browser-events.js';
import { createClosedWindows } from '../app/closed-windows.js';
import { createCommands } from '../app/commands.js';
import { createGroupDeletion } from '../app/delete-group.js';
import { createExternalMessageHandler } from '../app/external-messages.js';
import { createFirstRun } from '../app/first-run.js';
import { createGroupRecovery } from '../app/group-recovery.js';
import { createInitialization } from '../app/initialization.js';
import { createInitializationUi } from '../app/initialization-ui.js';
import { createMessageHandler } from '../app/message-handler.js';
import { createNativeGroupAssignment } from '../app/native-group-assignment.js';
import { createNativeGroupsSync } from '../app/native-groups-sync.js';
import { createOwnMoves } from '../app/own-moves.js';
import { createStartup } from '../app/startup.js';
import { createTabLifecycle } from '../app/tab-lifecycle.js';
import { createTabMoves } from '../app/tab-moves.js';
import { createToolbarService } from '../app/toolbar-service.js';
import { createUseNativeGroups } from '../app/use-native-groups.js';
import { createViewOpening } from '../app/view-opening.js';
import { createViewRefresh } from '../app/view-refresh.js';
import { createViewToggle } from '../app/view-toggle.js';
import { createVisibilityService } from '../app/visibility-service.js';
import { createWindowGroups } from '../app/window-groups.js';
import { createWindowRebuild } from '../app/window-rebuild.js';
import { browserModeOf, detectCapabilities } from '../share/capabilities.js';
import { createMenuManager } from '../app/menu-manager.js';
import { createMigrations, withMigratedWindows } from '../app/migrations.js';
import type { BackupFiles } from '../ports/backup-files.js';
import type { BackupLog } from '../ports/backup-log.js';
import type { Clock } from '../ports/clock.js';
import type { DataVersion } from '../ports/data-version.js';
import type { Extension } from '../ports/extension.js';
import type { GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { Menus } from '../ports/menus.js';
import type { Messaging } from '../ports/messaging.js';
import type { MigrationFlag } from '../ports/migration-flag.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { PendingUpdate } from '../ports/pending-update.js';
import type { Notifications } from '../ports/notifications.js';
import type { OptionsStore } from '../ports/options.js';
import type { Scheduler } from '../ports/scheduler.js';
import type { SessionHistory } from '../ports/session-history.js';
import type { Tabs } from '../ports/tabs.js';
import type { Toolbar } from '../ports/toolbar.js';
import type { Windows } from '../ports/windows.js';
import type { Capabilities } from '../share/capabilities.js';
import { stateManager } from './StateManager.js';

export interface Background {
  /** What the browser's events are handed over to */
  handlers: BackgroundHandlers;
  /** Get the extension going; the handlers wait for it */
  init: () => Promise<void>;
}

/** Everything the background is built out of: each is a port, which a browser or a test can give */
export interface BackgroundPorts {
  capabilities: Capabilities;
  tabs: Tabs;
  windows: Windows;
  nativeGroups: NativeGroups;
  toolbar: Toolbar;
  extension: Extension;
  menus: Menus;
  options: OptionsStore;
  migrationFlag: MigrationFlag;
  i18n: I18n;
  notifications: Notifications;
  messaging: Messaging;
  sessionHistory: SessionHistory;
  groupState: GroupState;
  backupFiles: BackupFiles;
  backupLog: BackupLog;
  dataVersion: DataVersion;
  pendingUpdate: PendingUpdate;
  clock: Clock;
  scheduler: Scheduler;
  logger: Logger;
}

/** The ports of the browser the background runs in */
function browserPorts(): BackgroundPorts {
  return {
    capabilities: detectCapabilities(browser),
    tabs: createBrowserTabs(() => browser),
    windows: createBrowserWindows(() => browser),
    nativeGroups: createBrowserNativeGroups(() => browser),
    toolbar: createBrowserToolbar(() => browser),
    extension: createBrowserExtension(() => browser),
    menus: createBrowserMenus(() => browser),
    options: createBrowserOptions(() => browser),
    migrationFlag: createBrowserMigrationFlag(() => browser),
    i18n: createBrowserI18n(() => browser),
    notifications: createBrowserNotifications(() => browser),
    messaging: createBrowserMessaging(() => browser),
    sessionHistory: createBrowserSessionHistory(() => browser),
    groupState: stateManager,
    backupFiles: createBrowserBackupFiles(
      () => browser,
      textLinksOf(URL),
      console,
    ),
    backupLog: createBrowserBackupLog(() => browser),
    dataVersion: createBrowserDataVersion(() => browser),
    pendingUpdate: createBrowserPendingUpdate(() => browser),
    clock: systemClock,
    scheduler: createSystemScheduler(),
    logger: console,
  };
}

/** Build everything the background does out of these ports */
export function composeBackgroundFrom({
  capabilities,
  tabs,
  windows,
  nativeGroups,
  toolbar,
  extension,
  menus,
  options,
  migrationFlag,
  i18n,
  notifications,
  messaging,
  sessionHistory,
  groupState: storedGroupState,
  backupFiles,
  backupLog,
  dataVersion,
  pendingUpdate,
  clock,
  scheduler,
  logger,
}: BackgroundPorts): Background {
  logger.debug('Browser capabilities:', {
    tabHide: capabilities.hasTabHide,
    tabGroups: capabilities.hasTabGroups,
    mode: browserModeOf(capabilities),
  });

  const useNativeGroups = createUseNativeGroups({
    hasTabGroups: capabilities.hasTabGroups,
    hasTabHide: capabilities.hasTabHide,
    options,
  });

  // Set by the options page while it opens a backup, whose tabs bring their own groups
  let openingBackup = false;
  const isOpeningBackup = () => openingBackup;

  // Every change of the groups is noted for the automatic backups, which read them as they are stored
  const autoBackup = createAutoBackup({
    snapshot: createBackupSnapshot({
      windows,
      tabs,
      groupState: storedGroupState,
    }),
    files: backupFiles,
    log: backupLog,
    clock,
    scheduler,
    isOpeningBackup,
    logger,
  });
  // Each window is brought to the current version of the stored data before it is used
  const migrations = createMigrations({
    groupState: storedGroupState,
    windows,
    tabs,
    dataVersion,
    migrationFlag,
    autoBackup,
    canHideTabs: capabilities.hasTabHide,
    useNativeGroups,
    logger,
  });
  const groupState = withBackupOnChange(
    withMigratedWindows(storedGroupState, migrations),
    autoBackup,
  );
  const addonUpdate = createAddonUpdate({
    autoBackup,
    tabs,
    extension,
    pendingUpdate,
    logger,
  });

  const menuManager = createMenuManager({
    menus,
    groupState,
    windows,
    i18n,
    logger,
  });
  const { createMenuList, handleMenuChange } = menuManager;
  const viewUrl = extension.urlOf('view.html');

  const initialization = createInitialization({ clock, scheduler, logger });
  const ui = createInitializationUi({
    notifications,
    toolbar,
    messaging,
    extension,
    i18n,
    logger,
  });
  const viewOpening = createViewOpening({ clock, scheduler, logger });
  const viewRefresh = createViewRefresh({ options, toolbar, logger });

  const toolbarService = createToolbarService({ groupState, toolbar, logger });
  const visibility = createVisibilityService({
    tabs,
    windows,
    groupState,
    nativeGroups,
    toolbar: toolbarService,
    canHideTabs: capabilities.hasTabHide,
    useNativeGroups,
    logger,
  });
  const assignment = createNativeGroupAssignment({
    tabs,
    windows,
    groupState,
    nativeGroups,
    i18n,
    logger,
  });

  const closedWindows = createClosedWindows({
    groupState: storedGroupState,
    windows,
    tabs,
    clock,
    logger,
  });
  // What the browser says of tabs the add-on moves between native groups is not the person's doing
  const ownMoves = createOwnMoves();
  const windowRebuild = createWindowRebuild({
    enabled: !capabilities.hasTabHide,
    groupState,
    // A window that closed is read as it was stored, not brought up to date for nothing
    archive: storedGroupState,
    windows,
    tabs,
    nativeGroups,
    i18n,
    viewUrl,
    logger,
  });
  const windowGroups = createWindowGroups({
    groupState,
    windows,
    i18n,
    clock,
    toolbar: toolbarService,
    waitForInitialization: initialization.waitForInitialization,
    isOpeningBackup,
    rebuildWindow: windowRebuild.rebuildWindow,
    logger,
  });
  const recovery = createGroupRecovery({
    groupState,
    tabs,
    windows,
    sessionHistory,
    initialization,
    ui,
    scheduler,
    logger,
  });
  const nativeGroupsSync = createNativeGroupsSync({
    groupState,
    tabs,
    windows,
    nativeGroups,
    assignment,
    migrationFlag,
    canHideTabs: capabilities.hasTabHide,
    logger,
  });

  const lifecycle = createTabLifecycle({
    groupState,
    tabs,
    nativeGroups,
    assignment,
    toggleVisibleTabs: (activeGroup, windowId) =>
      visibility.toggleVisibleTabs(activeGroup, undefined, windowId),
    useNativeGroups,
    waitForInitialization: initialization.waitForInitialization,
    isOpeningBackup,
    openingView: viewOpening.current,
    finishOpeningView: viewOpening.finish,
    clock,
    viewUrl,
    logger,
  });
  const tabMoves = createTabMoves({
    tabs,
    windows,
    groupState,
    nativeGroups,
    assignment,
    menus,
    createMenuList,
    toggleVisibleTabs: (activeGroup, windowId) =>
      visibility.toggleVisibleTabs(activeGroup, undefined, windowId),
    useNativeGroups,
    ownMoves,
    logger,
  });
  const triggerCommand = createCommands({
    windows,
    groupState,
    options,
    extension,
    showGroup: (activeGroup) => visibility.toggleVisibleTabs(activeGroup, true),
    logger,
  });
  const events = createBrowserEvents({
    groupState,
    tabs,
    nativeGroups,
    nativeGroupsSync,
    viewOpening,
    useNativeGroups,
    waitForInitialization: initialization.waitForInitialization,
    ownMoves,
    viewUrl,
    logger,
  });
  const deleteGroup = createGroupDeletion({
    tabs,
    nativeGroups,
    groupState,
    windowGroups,
    menus,
    hasTabGroups: capabilities.hasTabGroups,
    toggleVisibleTabs: (activeGroup, windowId) =>
      visibility.toggleVisibleTabs(activeGroup, undefined, windowId),
    logger,
  });

  const firstRun = createFirstRun({
    options,
    windows,
    tabs,
    capabilities,
    notifications,
    extension,
    i18n,
    logger,
  });

  return {
    handlers: {
      toggleView: createViewToggle({ tabs, windows, extension, viewOpening }),
      triggerCommand,
      createGroupInWindowIfMissing: windowGroups.createGroupInWindowIfMissing,
      windowRemoved: closedWindows.windowClosed,
      tabCreated: lifecycle.tabCreated,
      tabAttached: lifecycle.tabAttached,
      tabDetached: lifecycle.tabDetached,
      tabActivated: lifecycle.tabActivated,
      tabUpdated: events.onTabUpdated,
      tabRemoved: async (tabId) => {
        events.onTabRemoved(tabId);
        await closedWindows.tabClosed(tabId);
        await addonUpdate.tabRemoved(tabId);
      },
      menuClicked: tabMoves.menuClicked,
      handleMessage: createMessageHandler({
        handleMenuChange,
        deleteGroup,
        nativeGroupsSync,
        migrationFlag,
        viewRefresh,
        setOpeningBackup: (opening) => {
          openingBackup = opening;
        },
        autoBackup,
        logger,
      }),
      handleExternalMessage: createExternalMessageHandler({
        triggerCommand,
        logger,
      }),
      updateAvailable: addonUpdate.updateAvailable,
      storageChanged: events.onStorageChanged,
      nativeGroupRemoved: nativeGroupsSync.onRemoved,
      nativeGroupUpdated: nativeGroupsSync.onUpdated,
      notificationClicked: firstRun.noticeClicked,
    },
    init: createStartup({
      migrations,
      firstRun,
      windowRebuild,
      closedWindows,
      recovery,
      windowGroups,
      nativeGroupsSync,
      menuManager: { createMenuList },
      viewRefresh,
      autoBackup,
      useNativeGroups,
      logger,
    }),
  };
}

/** Build everything the background does out of the browser it runs in */
export function composeBackground(): Background {
  return composeBackgroundFrom(browserPorts());
}
