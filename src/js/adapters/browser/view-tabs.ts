import type { ViewTab, ViewTabs } from '../../ports/view-tabs.js';

/** A tab as the browser reports it */
export interface RawViewTab {
  id?: number | undefined;
  windowId?: number | undefined;
  index: number;
  title?: string | undefined;
  url?: string | undefined;
  favIconUrl?: string | undefined;
  pinned?: boolean | undefined;
  discarded?: boolean | undefined;
  lastAccessed?: number | undefined;
}

/** The part of `browser.tabs` the view uses */
export interface ViewTabsApi {
  tabs: {
    query(queryInfo: { currentWindow: true }): Promise<RawViewTab[]>;
    get(tabId: number): Promise<RawViewTab>;
    getCurrent(): Promise<{ id?: number | undefined } | undefined>;
    update(tabId: number, updateProperties: { active: true }): Promise<unknown>;
    remove(tabId: number): Promise<unknown>;
    move(tabId: number, moveProperties: { index: number }): Promise<unknown>;
    create(createProperties: {
      active: true;
    }): Promise<{ id?: number | undefined }>;
    // Firefox only
    captureTab?: (
      tabId: number,
      options: { format: 'jpeg'; quality: number },
    ) => Promise<string>;
  };
}

/** The tab as the view shows it; fails for one that has no id or window */
export function viewTabOf(tab: RawViewTab): ViewTab {
  if (tab.id === undefined || tab.windowId === undefined) {
    throw new Error('A tab has no id or window');
  }
  return {
    id: tab.id,
    windowId: tab.windowId,
    index: tab.index,
    title: tab.title ?? '',
    url: tab.url,
    favIconUrl: tab.favIconUrl,
    pinned: tab.pinned === true,
    discarded: tab.discarded === true,
    lastAccessed: tab.lastAccessed ?? 0,
  };
}

export function createBrowserViewTabs(getApi: () => ViewTabsApi): ViewTabs {
  const tabs = () => getApi().tabs;

  return {
    async list() {
      return (await tabs().query({ currentWindow: true })).map(viewTabOf);
    },
    async get(tabId) {
      return viewTabOf(await tabs().get(tabId));
    },
    async activate(tabId) {
      await tabs().update(tabId, { active: true });
    },
    async close(tabId) {
      await tabs().remove(tabId);
    },
    async moveTo(tabId, index) {
      await tabs().move(tabId, { index });
    },
    async openNew() {
      const { id } = await tabs().create({ active: true });
      if (id === undefined) {
        throw new Error('The new tab has no id');
      }
      return id;
    },
    async currentId() {
      const current = await tabs().getCurrent();
      if (current?.id === undefined) {
        throw new Error('This page is not in a tab');
      }
      return current.id;
    },
    capture(tabId) {
      const { captureTab } = tabs();
      return captureTab === undefined
        ? Promise.resolve(undefined)
        : captureTab(tabId, { format: 'jpeg', quality: 25 });
    },
  };
}
