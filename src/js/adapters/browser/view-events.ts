import type { Logger } from '../../ports/logger.js';
import type { ViewTab } from '../../ports/view-tabs.js';
import { viewTabOf, type RawViewTab } from './view-tabs.js';

/** One of the browser's events, which the view listens to */
interface Emitter<Args extends unknown[], Extra extends unknown[] = []> {
  addListener(listener: (...args: Args) => void, ...extra: Extra): void;
}

// The changes to a tab that the view shows. Not every property is listened
// to: the tab hiding and showing as the group changes would give a great many.
type UpdatedProperty =
  'discarded' | 'favIconUrl' | 'pinned' | 'title' | 'status';

/** The tab events of the browser that the view listens to */
export interface ViewEventsApi {
  tabs: {
    onCreated: Emitter<[RawViewTab]>;
    onRemoved: Emitter<[number, { windowId: number }]>;
    onUpdated: Emitter<
      [number, object, RawViewTab],
      [{ windowId: number; properties: UpdatedProperty[] }?]
    >;
    onMoved: Emitter<[number, { windowId: number }]>;
    onAttached: Emitter<[number, { newWindowId: number }]>;
    onDetached: Emitter<[number, { oldWindowId: number }]>;
  };
}

/** What the view does when the browser tells it something about tabs */
export interface ViewTabHandlers {
  tabCreated: (tab: ViewTab) => Promise<void>;
  tabRemoved: (tabId: number, removeInfo: { windowId: number }) => void;
  tabUpdated: (
    tabId: number,
    changeInfo: object,
    tab: ViewTab,
  ) => Promise<void>;
  tabMoved: (tabId: number, moveInfo: { windowId: number }) => Promise<void>;
  tabAttached: (
    tabId: number,
    attachInfo: { newWindowId: number },
  ) => Promise<void>;
  tabDetached: (tabId: number, detachInfo: { oldWindowId: number }) => void;
}

const UPDATED_PROPERTIES: UpdatedProperty[] = [
  'discarded',
  'favIconUrl',
  'pinned',
  'title',
  'status',
];

/**
 * Hand the tab events of the window to the view. A tab the browser does not
 * give an id and window for is left out.
 */
export function registerViewListeners(
  api: ViewEventsApi,
  windowId: number,
  handlers: ViewTabHandlers,
  logger: Pick<Logger, 'error'>,
): void {
  const run = (event: string, work: Promise<unknown>): void => {
    work.catch((error: unknown) => {
      logger.error(`[View] ${event} handler failed:`, error);
    });
  };
  const withTab = (raw: RawViewTab, use: (tab: ViewTab) => void): void => {
    if (raw.id !== undefined && raw.windowId !== undefined) {
      use(viewTabOf(raw));
    }
  };

  api.tabs.onCreated.addListener((raw) => {
    withTab(raw, (tab) => {
      run('tabs.onCreated', handlers.tabCreated(tab));
    });
  });
  api.tabs.onRemoved.addListener((tabId, removeInfo) => {
    handlers.tabRemoved(tabId, removeInfo);
  });

  const onUpdated = (tabId: number, changeInfo: object, raw: RawViewTab) => {
    withTab(raw, (tab) => {
      run('tabs.onUpdated', handlers.tabUpdated(tabId, changeInfo, tab));
    });
  };
  try {
    api.tabs.onUpdated.addListener(onUpdated, {
      // This page does not care about tabs in other windows
      windowId,
      properties: UPDATED_PROPERTIES,
    });
  } catch {
    // Chromium has no filters for this event, and gives an error for one
    api.tabs.onUpdated.addListener(onUpdated);
  }

  api.tabs.onMoved.addListener((tabId, moveInfo) => {
    run('tabs.onMoved', handlers.tabMoved(tabId, moveInfo));
  });
  api.tabs.onAttached.addListener((tabId, attachInfo) => {
    run('tabs.onAttached', handlers.tabAttached(tabId, attachInfo));
  });
  api.tabs.onDetached.addListener((tabId, detachInfo) => {
    handlers.tabDetached(tabId, detachInfo);
  });
}
