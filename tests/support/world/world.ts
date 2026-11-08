import { createBrowserGroupState } from '../../../src/js/adapters/browser/group-state.js';
import { createSessionsEmulation } from '../../../src/js/adapters/browser/sessions-emulation.js';
import { createFakeStorage } from '../fake-storage.js';
import type { BackgroundHandlers } from '../../../src/js/adapters/browser/events.js';
import { createMemoryBackupFiles } from '../../../src/js/adapters/memory/backup-files.js';
import { createMemoryBackupLog } from '../../../src/js/adapters/memory/backup-log.js';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryDataVersion } from '../../../src/js/adapters/memory/data-version.js';
import { createMemoryPendingUpdate } from '../../../src/js/adapters/memory/pending-update.js';
import { createMemoryExtension } from '../../../src/js/adapters/memory/extension.js';
import { createMemoryMenus } from '../../../src/js/adapters/memory/menus.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryMigrationFlag } from '../../../src/js/adapters/memory/migration-flag.js';
import { createMemoryNotifications } from '../../../src/js/adapters/memory/notifications.js';
import { createMemoryOptions } from '../../../src/js/adapters/memory/options.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import { createMemorySessionHistory } from '../../../src/js/adapters/memory/session-history.js';
import { createMemoryToolbar } from '../../../src/js/adapters/memory/toolbar.js';
import { createGroupsStore } from '../../../src/js/app/groups-store.js';
import { withUngroupedGroup } from '../../../src/js/app/with-ungrouped-group.js';
import {
  type BackgroundPorts,
  composeBackgroundFrom,
} from '../../../src/js/background/compose.js';
import { createDefaultOptions } from '../../../src/js/core/options.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import {
  type BrowserEvent,
  type ModelGroup,
  createBrowserModel,
} from './browser-model.js';
import {
  nativeGroupsOfModel,
  sessionsOfModel,
  tabsOfModel,
  windowsOfModel,
} from './model-ports.js';

/** What a test can see of a tab */
export interface SeenTab {
  id: number;
  /** The native tab group it is in, or -1 */
  nativeGroupId: number;
  /** The group of the extension it is in, as the extension recorded it */
  group: number | undefined;
  hidden: boolean;
  active: boolean;
}

export interface SeenWindow {
  id: number;
  tabs: SeenTab[];
}

export interface WorldOptions {
  /** Whether the browser has native tab groups (Firefox 139 and later, Chromium) */
  hasTabGroups?: boolean;
  /** Whether the browser can hide tabs (Firefox) */
  hasTabHide?: boolean;
  /** What the user's settings already say, as storage holds it */
  stored?: Record<string, unknown>;
  /** Whether the migration to native tab groups has been done before */
  migrated?: boolean;
}

const text = (args: readonly unknown[]): string =>
  args
    .map((arg) => (arg instanceof Error ? arg.message : String(arg)))
    .join(' ');

/**
 * A browser, the add-on running in it as it does in a real one, and what a person does:
 * the whole background of the add-on, built by `composeBackgroundFrom` out of ports that
 * all look at one model of the browser (see `browser-model.ts`).
 *
 * Every action waits until the add-on has done what the browser's events made it do,
 * and then the test looks at what is there.
 */
export function createWorld({
  hasTabGroups = true,
  hasTabHide = true,
  stored = {},
  migrated = false,
}: WorldOptions = {}) {
  let handlers: BackgroundHandlers | undefined;
  const pending: Promise<unknown>[] = [];
  const logs: { debug: string[]; warn: string[]; error: string[] } = {
    debug: [],
    warn: [],
    error: [],
  };

  const track = (work: Promise<unknown>): void => {
    pending.push(
      work.catch((error: unknown) => logs.error.push(text([error]))),
    );
  };

  const groupEvent = ({ id, windowId, title }: ModelGroup) => ({
    id,
    windowId,
    title,
  });

  /** What the browser tells the add-on, as it tells it */
  function onEvent(event: BrowserEvent): void {
    if (handlers === undefined) {
      return;
    }
    switch (event.type) {
      case 'windowCreated':
        track(handlers.createGroupInWindowIfMissing(event.windowId));
        break;
      case 'windowRemoved':
        track(handlers.windowRemoved(event.windowId));
        break;
      case 'tabCreated':
        track(
          handlers.tabCreated({
            id: event.tab.id,
            windowId: event.tab.windowId,
            active: event.tab.active,
            pinned: event.tab.pinned,
            hidden: event.tab.hidden,
            url: event.tab.url,
            pendingUrl: undefined,
            browserGroupId: event.tab.groupId,
          }),
        );
        break;
      case 'tabAttached':
        track(
          handlers.tabAttached(event.tabId, { newWindowId: event.windowId }),
        );
        break;
      case 'tabDetached':
        track(handlers.tabDetached(event.tabId));
        break;
      case 'tabActivated':
        track(handlers.tabActivated({ tabId: event.tabId }));
        break;
      case 'tabUpdated':
        track(
          handlers.tabUpdated(
            event.tab.id,
            {
              ...(event.change.pinned === undefined
                ? {}
                : { pinned: event.change.pinned }),
              ...(event.change.groupId === undefined
                ? {}
                : { groupId: event.change.groupId }),
            },
            {
              url: event.tab.url,
              pendingUrl: undefined,
              windowId: event.tab.windowId,
              pinned: event.tab.pinned,
            },
          ),
        );
        break;
      case 'tabRemoved':
        track(handlers.tabRemoved(event.tabId));
        break;
      case 'groupRemoved':
        track(handlers.nativeGroupRemoved(groupEvent(event.group)));
        break;
      case 'groupUpdated':
        track(handlers.nativeGroupUpdated(groupEvent(event.group)));
        break;
      default:
        break;
    }
  }

  const model = createBrowserModel(onEvent);
  const emulationStorage = createFakeStorage();
  const clock = createMemoryClock(1_000_000);
  const options = createMemoryOptions({
    defaults: createDefaultOptions('1.0', hasTabGroups),
    stored,
  });
  const messaging = createMemoryMessaging();
  const migrationFlag = createMemoryMigrationFlag(migrated);
  const menus = createMemoryMenus();
  const toolbar = createMemoryToolbar();
  const notifications = createMemoryNotifications();
  const extension = createMemoryExtension();
  const backupFiles = createMemoryBackupFiles();
  const backupLog = createMemoryBackupLog();
  // As the profile of a user who has run the add-on before keeps it
  const dataVersion = createMemoryDataVersion();
  const scheduler = createMemoryScheduler();
  // Where tabs cannot be hidden (Chromium) the values are kept under the id of their window or tab,
  // which a restart or a window that is reopened changes, and nothing removes them
  const emulation = createSessionsEmulation(() => emulationStorage.area);
  const modelSessions = sessionsOfModel(model);
  const groupState = withUngroupedGroup(
    createBrowserGroupState(() =>
      hasTabHide
        ? modelSessions
        : {
            storage: modelSessions.storage,
            sessions: emulation,
            sessionsManagement: emulation,
          },
    ),
    clock,
  );

  // An API that the browser does not have is not there to be called, as `browser.tabGroups` is not
  // in a Firefox before 139, and a call fails as calling what is not there does
  const absent =
    (api: string): (() => Promise<never>) =>
    () =>
      Promise.reject(new TypeError(`browser.${api} is undefined`));
  const withoutTabHide = (tabs: ReturnType<typeof tabsOfModel>) => ({
    ...tabs,
    hide: absent('tabs.hide'),
    show: absent('tabs.show'),
    // Chromium refuses a query for hidden tabs, as it has none
    hiddenIdsInWindow: absent('tabs.query hidden'),
  });
  const withoutNativeGroups = (): ReturnType<typeof nativeGroupsOfModel> => ({
    setCollapsed: absent('tabGroups.update'),
    listIdsInWindow: absent('tabGroups.query'),
    tabIdsIn: absent('tabs.query'),
    createFromTabs: absent('tabs.group'),
    addTabs: absent('tabs.group'),
    removeTabs: absent('tabs.ungroup'),
    setTitle: absent('tabGroups.update'),
    setAppearance: absent('tabGroups.update'),
    get: absent('tabGroups.get'),
  });

  const ports = (): BackgroundPorts => ({
    capabilities: { hasTabHide, hasTabGroups },
    tabs: hasTabHide ? tabsOfModel(model) : withoutTabHide(tabsOfModel(model)),
    windows: windowsOfModel(model),
    nativeGroups: hasTabGroups
      ? nativeGroupsOfModel(model)
      : withoutNativeGroups(),
    toolbar,
    extension,
    menus,
    options,
    migrationFlag,
    i18n: {
      getMessage: (name) => (name === 'defaultGroupName' ? 'Grp' : name),
    },
    notifications,
    messaging,
    sessionHistory: createMemorySessionHistory(),
    groupState,
    backupFiles,
    backupLog,
    dataVersion,
    pendingUpdate: createMemoryPendingUpdate(),
    // The model has no private windows
    clock,
    scheduler,
    logger: {
      debug: (...args) => logs.debug.push(text(args)),
      warn: (...args) => logs.warn.push(text(args)),
      error: (...args) => logs.error.push(text(args)),
    },
  });

  /** Wait until the add-on has done everything the events asked of it, and what that led to */
  async function settled(): Promise<void> {
    const batch = pending.splice(0);
    if (batch.length === 0) {
      return;
    }
    await Promise.allSettled(batch);
    await settled();
  }

  /** The groups of a window as its view has them: they ask the background for what is not theirs */
  const viewGroups = (windowId: number) =>
    createGroupsStore(
      {
        groupState,
        messaging: {
          send: (message) => {
            const answer = Promise.resolve(handlers?.handleMessage(message));
            pending.push(answer);
            return answer;
          },
        },
        nativeGroups: hasTabGroups
          ? nativeGroupsOfModel(model)
          : withoutNativeGroups(),
        tabs: {
          listIdsInCurrentWindow: () =>
            Promise.resolve(model.tabsOf(windowId).map(({ id }) => id)),
        },
        clock,
        i18n: ports().i18n,
        logger: ports().logger,
      },
      windowId,
    );

  const world = {
    model,
    options,
    messaging,
    menus,
    /** What the toolbar button shows: its title and badge for each window */
    toolbar,
    /** Whether the migration to native groups was done */
    migrationFlag,
    /** The notifications on show */
    notifications,
    /** The extension, as the browser knows it: it counts the times the options page was opened */
    extension,
    groupState,
    /** Whether the browser can hide tabs (Firefox); the other keeps its values under ids (Chromium) */
    hasTabHide,
    /** What the add-on logged; an error here is a bug found */
    logs,
    /** The files the add-on wrote by itself: its automatic backups */
    backupFiles,
    clock,
    /** The add-on's timers, which run only when a test moves time on */
    scheduler,
    /** The version of the stored data of the profile */
    dataVersion,

    /** The add-on starts in the browser: the first run, or the browser starting */
    async start(): Promise<void> {
      const background = composeBackgroundFrom(ports());
      handlers = background.handlers;
      await background.init();
      await settled();
    },

    /** Everything the browser has told the add-on is done with: for a test that makes the browser act itself */
    settle: settled,

    /** The browser is closed and opened again, and the add-on starts again */
    async restart(): Promise<void> {
      handlers = undefined;
      model.restart();
      await world.start();
    },

    /** A window that was open before the add-on was: nothing is told */
    seedWindow: (urls: readonly string[]) => model.seedWindow(urls),

    async openWindow(urls: readonly string[]) {
      const opened = model.openWindow(urls);
      await settled();
      return opened;
    },

    async openTab(
      windowId: number,
      url = 'https://example.test/',
      active = false,
      pinned = false,
    ) {
      const id = model.openTab(windowId, url, active, pinned);
      await settled();
      return id;
    },

    /** The user pins a tab, or unpins it */
    async setPinned(tabId: number, pinned: boolean): Promise<void> {
      model.setPinned(tabId, pinned);
      await settled();
    },

    async closeTab(tabId: number): Promise<void> {
      model.closeTab(tabId);
      await settled();
    },

    async closeWindow(windowId: number): Promise<void> {
      model.closeWindow(windowId);
      await settled();
    },

    /** "Undo close window": the window that was closed last comes back */
    async restoreWindow() {
      const restored = model.restoreWindow();
      await settled();
      return restored;
    },

    /** The user sends a tab to a group by the context menu of the tab */
    async sendTabToGroup(tabId: number, groupId: number): Promise<void> {
      const windowId = model.tabs.get(tabId)?.windowId;
      await handlers?.menuClicked(
        { menuItemId: `${String(windowId)}:${String(groupId)}` },
        { id: tabId, windowId },
      );
      await settled();
    },

    /**
     * The user closes a group in the view, which asks the background to delete it; the background
     * puts right what the window shows
     */
    async deleteGroup(windowId: number, groupId: number): Promise<unknown> {
      const group = (await groupState.getGroups(windowId))?.find(
        ({ id }) => id === groupId,
      );
      const tabIds = (
        await Promise.all(
          model.tabsOf(windowId).map(async ({ id }) => ({
            id,
            group: await groupState.getTabGroup(id),
          })),
        )
      )
        .filter((tab) => tab.group === groupId)
        .map(({ id }) => id);
      const answer = await world.message({
        action: 'deleteGroup',
        groupId,
        windowId,
        nativeGroupId: group?.nativeGroupId,
        tabIds,
      });
      return answer;
    },

    /** The user makes a group in the view of a window; the id of the group */
    async createGroup(windowId: number): Promise<number> {
      const { id } = await (await viewGroups(windowId)).create();
      await settled();
      return id;
    },

    /** The user gives a group of a window another name in the view */
    async renameGroup(
      windowId: number,
      groupId: number,
      name: string,
    ): Promise<void> {
      await (await viewGroups(windowId)).rename(groupId, name);
      await settled();
    },

    async moveTab(tabId: number, windowId: number): Promise<void> {
      model.moveTab(tabId, windowId);
      await settled();
    },

    async activateTab(tabId: number): Promise<void> {
      model.activateTab(tabId);
      await settled();
    },

    async focusWindow(windowId: number): Promise<void> {
      model.focusWindow(windowId);
      await handlers?.windowFocused(windowId);
      await settled();
    },

    /** The user takes a tab group apart, as "Ungroup" does */
    async ungroupGroup(groupId: number): Promise<void> {
      model.ungroup(
        [...model.tabs.values()]
          .filter((tab) => tab.groupId === groupId)
          .map(({ id }) => id),
      );
      await settled();
    },

    /** The user changes a setting on the options page, as it does: saves it, then tells the background */
    async setNativeGroups(on: boolean): Promise<void> {
      const before = (await options.load()).useNativeGroups;
      await options.save({ useNativeGroups: on });
      handlers
        ?.storageChanged(
          { useNativeGroups: { oldValue: before, newValue: on } },
          'sync',
        )
        .catch((error: unknown) => logs.error.push(text([error])));
      await handlers?.handleMessage({
        action: on ? 'migrateToHybridGroups' : 'cleanupNativeGroups',
      });
      await settled();
    },

    /** The user does something that the add-on's own message handler is asked to do */
    async message(message: unknown): Promise<unknown> {
      const answer = await handlers?.handleMessage(message);
      await settled();
      return answer;
    },

    /** The user clicks a notification of the add-on */
    async clickNotification(id: string): Promise<void> {
      await handlers?.notificationClicked(id);
      await settled();
    },

    /** The browser has a new version of the add-on to apply */
    async updateAvailable(): Promise<void> {
      await handlers?.updateAvailable();
      await settled();
    },

    /** Time passes: the clock moves on, and the add-on's timers that come due run */
    async wait(ms: number): Promise<void> {
      clock.advance(ms);
      scheduler.advance(ms);
      // A timer's work is not an event the world tracks; the ports all answer at once, so it is
      // done before the next task
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      await settled();
    },

    /** The user presses a keyboard shortcut of the add-on */
    async command(command: string): Promise<void> {
      await handlers?.triggerCommand(command);
      await settled();
    },

    // What there is to look at

    /** The groups of the add-on in a window, as it recorded them */
    async groupsOf(windowId: number): Promise<Group[]> {
      return (await groupState.getGroups(windowId)) ?? [];
    },

    /** Each window with its tabs, and where each is in the browser's groups and the add-on's */
    async windows(): Promise<SeenWindow[]> {
      return Promise.all(
        [...model.windows.values()].map(async (window) => ({
          id: window.id,
          tabs: await Promise.all(
            model.tabsOf(window.id).map(async (tab) => ({
              id: tab.id,
              nativeGroupId: tab.groupId,
              group: await groupState.getTabGroup(tab.id),
              hidden: tab.hidden,
              active: tab.active,
            })),
          ),
        })),
      );
    },
  };
  return world;
}

export type World = ReturnType<typeof createWorld>;
