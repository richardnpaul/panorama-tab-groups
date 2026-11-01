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
import { createBrowserEvents } from '../app/browser-events.js';
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
import { browserModeOf, detectCapabilities } from '../share/capabilities.js';
import { createMenuManager } from '../app/menu-manager.js';
import type { Clock } from '../ports/clock.js';
import type { Extension } from '../ports/extension.js';
import type { GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { Menus } from '../ports/menus.js';
import type { Messaging } from '../ports/messaging.js';
import type { MigrationFlag } from '../ports/migration-flag.js';
import type { NativeGroups } from '../ports/native-groups.js';
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
  groupState,
  clock,
  scheduler,
  logger,
}: BackgroundPorts): Background {
  logger.debug('Browser capabilities:', {
    tabHide: capabilities.hasTabHide,
    tabGroups: capabilities.hasTabGroups,
    mode: browserModeOf(capabilities),
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
  const useNativeGroups = createUseNativeGroups({
    hasTabGroups: capabilities.hasTabGroups,
    options,
  });

  // Set by the options page while it opens a backup, whose tabs bring their own groups
  let openingBackup = false;
  const isOpeningBackup = () => openingBackup;

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

  const windowGroups = createWindowGroups({
    groupState,
    windows,
    i18n,
    clock,
    toolbar: toolbarService,
    waitForInitialization: initialization.waitForInitialization,
    isOpeningBackup,
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
    nativeGroups,
    nativeGroupsSync,
    viewOpening,
    useNativeGroups,
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
    logger,
  });

  const firstRun = createFirstRun({
    options,
    windows,
    tabs,
    groupState,
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
      tabCreated: lifecycle.tabCreated,
      tabAttached: lifecycle.tabAttached,
      tabDetached: lifecycle.tabDetached,
      tabActivated: lifecycle.tabActivated,
      tabUpdated: events.onTabUpdated,
      tabRemoved: events.onTabRemoved,
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
        logger,
      }),
      handleExternalMessage: createExternalMessageHandler({
        triggerCommand,
        logger,
      }),
      storageChanged: events.onStorageChanged,
      nativeGroupRemoved: nativeGroupsSync.onRemoved,
      nativeGroupUpdated: nativeGroupsSync.onUpdated,
      notificationClicked: firstRun.noticeClicked,
    },
    init: createStartup({
      firstRun,
      recovery,
      windowGroups,
      nativeGroupsSync,
      menuManager: { createMenuList },
      viewRefresh,
      useNativeGroups,
      logger,
    }),
  };
}

/** Build everything the background does out of the browser it runs in */
export function composeBackground(): Background {
  return composeBackgroundFrom(browserPorts());
}
