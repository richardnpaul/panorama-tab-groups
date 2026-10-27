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
  url?: string | undefined;
  pendingUrl?: string | undefined;
}

interface RawNativeGroup {
  id: number;
  windowId: number;
  title?: string | undefined;
}

/** The events of the browser that the background listens to */
export interface EventsApi {
  action: { onClicked: Emitter<[unknown]> };
  commands: { onCommand: Emitter<[string]> };
  windows: { onCreated: Emitter<[{ id?: number | undefined }]> };
  tabs: {
    onCreated: Emitter<[RawTab]>;
    onAttached: Emitter<[number, { newWindowId: number }]>;
    onDetached: Emitter<[number]>;
    onActivated: Emitter<[{ tabId: number }]>;
    onUpdated: Emitter<[number, { url?: string | undefined }, RawTab]>;
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
  };
  contextMenus: {
    onClicked: Emitter<
      [{ menuItemId: string | number }, ClickedTab | undefined]
    >;
  };
}

/** What the extension does when the browser tells it something */
export interface BackgroundHandlers {
  toggleView: () => Promise<void>;
  triggerCommand: (command: string) => Promise<void>;
  createGroupInWindowIfMissing: (windowId: number) => Promise<void>;
  tabCreated: (tab: CreatedTab) => Promise<void>;
  tabAttached: (
    tabId: number,
    attachInfo: { newWindowId: number },
  ) => Promise<void>;
  tabDetached: (tabId: number) => Promise<void>;
  tabActivated: (activeInfo: { tabId: number }) => Promise<void>;
  tabUpdated: BrowserEvents['onTabUpdated'];
  tabRemoved: BrowserEvents['onTabRemoved'];
  menuClicked: (
    info: { menuItemId: string | number },
    tab: ClickedTab | undefined,
  ) => Promise<void>;
  handleMessage: (message: unknown) => Promise<unknown>;
  handleExternalMessage: (message: unknown) => Promise<void>;
  storageChanged: BrowserEvents['onStorageChanged'];
  nativeGroupRemoved: (group: NativeGroupEvent) => Promise<void>;
  nativeGroupUpdated: (group: NativeGroupEvent) => Promise<void>;
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
        url: tab.url,
        pendingUrl: tab.pendingUrl,
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
    handlers.tabRemoved(tabId);
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

  api.contextMenus.onClicked.addListener((info, tab) => {
    run('contextMenus.onClicked', handlers.menuClicked(info, tab));
  });
}
