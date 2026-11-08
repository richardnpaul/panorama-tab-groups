import type { BrowserEvents } from '../../app/browser-events.js';
import type { ClickedTab } from '../../app/tab-moves.js';
import type { CreatedTab } from '../../app/tab-lifecycle.js';
import type { NativeGroupEvent } from '../../app/native-groups-sync.js';
import type { Logger } from '../../ports/logger.js';

/** One of the browser's events, of which the extension listens */
interface Emitter<Args extends unknown[], Result = void> {
  addListener(listener: (...args: Args) => Result): void;
}

interface RawTab {
  id?: number | undefined;
  windowId?: number | undefined;
  active?: boolean | undefined;
  pinned?: boolean | undefined;
  // Only browsers that can hide tabs say
  hidden?: boolean | undefined;
  url?: string | undefined;
  pendingUrl?: string | undefined;
  groupId?: number | undefined;
}

/** What changed about a tab, as the browser says it */
interface RawTabChange {
  url?: string | undefined;
  pinned?: boolean | undefined;
  groupId?: number | undefined;
}

interface RawNativeGroup {
  id: number;
  windowId: number;
  title?: string | undefined;
}

/** What the browser gives when no browser window has the focus */
const WINDOW_ID_NONE = -1;

/** The events of the browser that the background listens to */
export interface EventsApi {
  action: { onClicked: Emitter<[unknown]> };
  commands: { onCommand: Emitter<[string]> };
  windows: {
    onCreated: Emitter<[{ id?: number | undefined }]>;
    onRemoved: Emitter<[number]>;
    onFocusChanged: Emitter<[number]>;
  };
  tabs: {
    onCreated: Emitter<[RawTab]>;
    onAttached: Emitter<[number, { newWindowId: number }]>;
    onDetached: Emitter<[number]>;
    onActivated: Emitter<[{ tabId: number }]>;
    onUpdated: Emitter<[number, RawTabChange, RawTab]>;
    onRemoved: Emitter<[number, unknown]>;
  };
  // Browsers without native tab groups have none of these
  tabGroups?: {
    onRemoved: Emitter<[RawNativeGroup]>;
    onUpdated: Emitter<[RawNativeGroup]>;
  };
  storage: {
    onChanged: Emitter<
      [Record<string, { oldValue?: unknown; newValue?: unknown }>, string]
    >;
  };
  runtime: {
    onMessage: Emitter<
      [unknown, unknown, (response?: unknown) => void],
      boolean
    >;
    onMessageExternal: Emitter<[unknown]>;
    onUpdateAvailable: Emitter<[unknown]>;
  };
  contextMenus: {
    onClicked: Emitter<
      [{ menuItemId: string | number }, ClickedTab | undefined]
    >;
  };
  notifications: { onClicked: Emitter<[string]> };
}

/** What the extension does when the browser tells it something */
export interface BackgroundHandlers {
  toggleView: () => Promise<void>;
  triggerCommand: (command: string) => Promise<void>;
  createGroupInWindowIfMissing: (windowId: number) => Promise<void>;
  /** A window was closed */
  windowRemoved: (windowId: number) => Promise<void>;
  /** Another window was given the focus */
  windowFocused: (windowId: number) => Promise<void>;
  tabCreated: (tab: CreatedTab) => Promise<void>;
  tabAttached: (
    tabId: number,
    attachInfo: { newWindowId: number },
  ) => Promise<void>;
  tabDetached: (tabId: number) => Promise<void>;
  tabActivated: (activeInfo: { tabId: number }) => Promise<void>;
  tabUpdated: BrowserEvents['onTabUpdated'];
  tabRemoved: (tabId: number) => Promise<void>;
  menuClicked: (
    info: { menuItemId: string | number },
    tab: ClickedTab | undefined,
  ) => Promise<void>;
  handleMessage: (message: unknown) => Promise<unknown>;
  handleExternalMessage: (message: unknown) => Promise<void>;
  /** A new version of the add-on is waiting to be applied */
  updateAvailable: () => Promise<void>;
  storageChanged: BrowserEvents['onStorageChanged'];
  nativeGroupRemoved: (group: NativeGroupEvent) => Promise<void>;
  nativeGroupUpdated: (group: NativeGroupEvent) => Promise<void>;
  notificationClicked: (id: string) => Promise<void>;
}

/** The tab, if the browser has said which one it is and where */
function createdTabOf(tab: RawTab): CreatedTab | undefined {
  const { id, windowId } = tab;
  return id === undefined || windowId === undefined
    ? undefined
    : {
        id,
        windowId,
        active: tab.active,
        pinned: tab.pinned,
        hidden: tab.hidden,
        url: tab.url,
        pendingUrl: tab.pendingUrl,
        browserGroupId: tab.groupId,
      };
}

/**
 * Hand every event the extension listens to over to what handles it. All of
 * the listeners are added at once, before anything is awaited: a background
 * that is woken by an event must have its listener in place by then.
 */
export function registerListeners(
  api: EventsApi,
  handlers: BackgroundHandlers,
  logger: Pick<Logger, 'error'>,
): void {
  // An event has nobody to report a failure to, so it is logged
  const run = (event: string, work: Promise<unknown>): void => {
    work.catch((error: unknown) => {
      logger.error(`[${event}] handler failed:`, error);
    });
  };

  api.action.onClicked.addListener(() => {
    run('action.onClicked', handlers.toggleView());
  });
  api.commands.onCommand.addListener((command) => {
    run('commands.onCommand', handlers.triggerCommand(command));
  });
  api.windows.onCreated.addListener(({ id }) => {
    if (id !== undefined) {
      run('windows.onCreated', handlers.createGroupInWindowIfMissing(id));
    }
  });

  api.windows.onRemoved.addListener((windowId) => {
    run('windows.onRemoved', handlers.windowRemoved(windowId));
  });
  api.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== WINDOW_ID_NONE) {
      run('windows.onFocusChanged', handlers.windowFocused(windowId));
    }
  });

  api.tabs.onCreated.addListener((raw) => {
    const tab = createdTabOf(raw);
    if (tab !== undefined) {
      run('tabs.onCreated', handlers.tabCreated(tab));
    }
  });
  api.tabs.onAttached.addListener((tabId, attachInfo) => {
    run('tabs.onAttached', handlers.tabAttached(tabId, attachInfo));
  });
  api.tabs.onDetached.addListener((tabId) => {
    run('tabs.onDetached', handlers.tabDetached(tabId));
  });
  api.tabs.onActivated.addListener((activeInfo) => {
    run('tabs.onActivated', handlers.tabActivated(activeInfo));
  });
  api.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    run('tabs.onUpdated', handlers.tabUpdated(tabId, changeInfo, tab));
  });
  api.tabs.onRemoved.addListener((tabId) => {
    run('tabs.onRemoved', handlers.tabRemoved(tabId));
  });

  api.tabGroups?.onRemoved.addListener((group) => {
    run('tabGroups.onRemoved', handlers.nativeGroupRemoved(group));
  });
  api.tabGroups?.onUpdated.addListener((group) => {
    run('tabGroups.onUpdated', handlers.nativeGroupUpdated(group));
  });

  api.storage.onChanged.addListener((changes, areaName) => {
    run('storage.onChanged', handlers.storageChanged(changes, areaName));
  });

  // Answered later, so the channel is kept open for the answer
  api.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handlers
      .handleMessage(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        logger.error('[runtime.onMessage] handler failed:', error);
        sendResponse({ error: 'The background failed to handle the message' });
      });
    return true;
  });
  api.runtime.onMessageExternal.addListener((message) => {
    run('runtime.onMessageExternal', handlers.handleExternalMessage(message));
  });
  // A listener holds the update back until the add-on starts again (MDN), which it does itself
  api.runtime.onUpdateAvailable.addListener(() => {
    run('runtime.onUpdateAvailable', handlers.updateAvailable());
  });

  api.contextMenus.onClicked.addListener((info, tab) => {
    run('contextMenus.onClicked', handlers.menuClicked(info, tab));
  });

  api.notifications.onClicked.addListener((id) => {
    run('notifications.onClicked', handlers.notificationClicked(id));
  });
}
