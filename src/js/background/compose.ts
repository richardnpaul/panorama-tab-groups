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
import { createMenuList, handleMenuChange } from './menu-manager.js';
import { stateManager } from './StateManager.js';

export interface Background {
  /** What the browser's events are handed over to */
  handlers: BackgroundHandlers;
  /** Get the extension going; the handlers wait for it */
  init: () => Promise<void>;
}

/** Build everything the background does out of the browser it runs in */
export function composeBackground(): Background {
  const logger = console;
  const clock = systemClock;
  const scheduler = createSystemScheduler();
  const groupState = stateManager;

  const capabilities = detectCapabilities(browser);
  logger.debug('Browser capabilities:', {
    tabHide: capabilities.hasTabHide,
    tabGroups: capabilities.hasTabGroups,
    mode: browserModeOf(capabilities),
  });

  const tabs = createBrowserTabs(() => browser);
  const windows = createBrowserWindows(() => browser);
  const nativeGroups = createBrowserNativeGroups(() => browser);
  const toolbar = createBrowserToolbar(() => browser);
  const extension = createBrowserExtension(() => browser);
  const menus = createBrowserMenus(() => browser);
  const options = createBrowserOptions(() => browser);
  const migrationFlag = createBrowserMigrationFlag(() => browser);
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
    notifications: createBrowserNotifications(() => browser),
    toolbar,
    messaging: createBrowserMessaging(() => browser),
    extension,
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
    viewUrl,
    logger,
  });

  const windowGroups = createWindowGroups({
    groupState,
    windows,
    i18n: createBrowserI18n(() => browser),
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
    sessionHistory: createBrowserSessionHistory(() => browser),
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
    toggleVisibleTabs: (activeGroup) =>
      visibility.toggleVisibleTabs(activeGroup),
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
    menus,
    createMenuList,
    toggleVisibleTabs: (activeGroup) =>
      visibility.toggleVisibleTabs(activeGroup),
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
    tabs,
    nativeGroupsSync,
    viewOpening,
    useNativeGroups,
    viewUrl,
    version: browser.runtime.getManifest().version,
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
      installed: events.onInstalled,
      storageChanged: events.onStorageChanged,
      nativeGroupRemoved: nativeGroupsSync.onRemoved,
      nativeGroupUpdated: nativeGroupsSync.onUpdated,
    },
    init: createStartup({
      recovery,
      windowGroups,
      nativeGroupsSync,
      menuManager: { createMenuList },
      viewRefresh,
      hasTabGroups: capabilities.hasTabGroups,
      logger,
    }),
  };
}
