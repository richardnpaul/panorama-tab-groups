import type { TabDetails, Tabs, TabSnapshot } from '../../ports/tabs.js';

interface QueriedTab {
  id?: number | undefined;
  windowId?: number | undefined;
  active?: boolean | undefined;
  pinned?: boolean | undefined;
  lastAccessed?: number | undefined;
  url?: string | undefined;
  pendingUrl?: string | undefined;
  title?: string | undefined;
  groupId?: number | undefined;
  index?: number | undefined;
}

/** The part of `browser.tabs` the extension uses */
export interface TabsApi {
  tabs: {
    query(queryInfo: {
      currentWindow?: boolean;
      windowId?: number;
      highlighted?: boolean;
      hidden?: boolean;
    }): Promise<QueriedTab[]>;
    get(tabId: number): Promise<QueriedTab>;
    update(
      tabId: number,
      updateProperties: { active: boolean },
    ): Promise<unknown>;
    move(tabId: number, moveProperties: { index: number }): Promise<unknown>;
    remove(tabId: number): Promise<unknown>;
    create(createProperties: {
      url: string;
      active: boolean;
      windowId?: number;
      discarded?: boolean;
      pinned?: boolean;
    }): Promise<{ id?: number | undefined }>;
    hide(tabIds: number[]): Promise<unknown>;
    show(tabIds: number[]): Promise<unknown>;
  };
}

function detailsOf(
  tab: QueriedTab,
  id: number,
  windowId: number | undefined,
): TabDetails {
  if (windowId === undefined) {
    throw new Error(`Tab ${String(id)} has no window`);
  }
  return {
    id,
    windowId,
    active: tab.active === true,
    pinned: tab.pinned === true,
    url: tab.url,
    pendingUrl: tab.pendingUrl,
    title: tab.title,
    browserGroupId: tab.groupId,
  };
}

// The id of the tab the browser opened for a page
async function createdTabId(
  created: Promise<{ id?: number | undefined }>,
  url: string,
): Promise<number> {
  const { id } = await created;
  if (id === undefined) {
    throw new Error(`The new tab for ${url} has no id`);
  }
  return id;
}

const idsOf = (tabs: readonly QueriedTab[]): number[] =>
  tabs.flatMap(({ id }) => (id === undefined ? [] : [id]));

export function createBrowserTabs(getApi: () => TabsApi): Tabs {
  const queryCurrentWindow = () => getApi().tabs.query({ currentWindow: true });

  return {
    async listIdsInCurrentWindow() {
      return idsOf(await queryCurrentWindow());
    },

    async listInCurrentWindow() {
      const tabs = await queryCurrentWindow();
      return tabs.flatMap(({ id, pinned, lastAccessed }) =>
        id === undefined
          ? []
          : [{ id, pinned: pinned === true, lastAccessed: lastAccessed ?? 0 }],
      );
    },

    async get(tabId) {
      const tab = await getApi().tabs.get(tabId);
      return detailsOf(tab, tabId, tab.windowId);
    },

    async listInWindow(windowId) {
      const tabs = await getApi().tabs.query({ windowId });
      return tabs.flatMap((tab) =>
        tab.id === undefined
          ? []
          : [detailsOf(tab, tab.id, tab.windowId ?? windowId)],
      );
    },

    async highlightedIdsInWindow(windowId) {
      return idsOf(await getApi().tabs.query({ windowId, highlighted: true }));
    },

    async visibleIdsInWindow(windowId) {
      return idsOf(await getApi().tabs.query({ windowId, hidden: false }));
    },

    async activate(tabId) {
      await getApi().tabs.update(tabId, { active: true });
    },

    async moveToEnd(tabId) {
      await getApi().tabs.move(tabId, { index: -1 });
    },

    async close(tabId) {
      await getApi().tabs.remove(tabId);
    },

    async snapshotsInWindow(windowId) {
      const tabs = await getApi().tabs.query({ windowId });
      return tabs.flatMap((tab, position): TabSnapshot[] =>
        tab.id === undefined
          ? []
          : [
              {
                id: tab.id,
                url: tab.url,
                title: tab.title,
                index: tab.index ?? position,
                lastAccessed: tab.lastAccessed ?? 0,
                pinned: tab.pinned === true,
              },
            ],
      );
    },

    create: (options) =>
      createdTabId(getApi().tabs.create(options), options.url),

    open: (url, active) =>
      createdTabId(getApi().tabs.create({ url, active }), url),

    async hide(tabIds) {
      await getApi().tabs.hide([...tabIds]);
    },

    async show(tabIds) {
      await getApi().tabs.show([...tabIds]);
    },
  };
}
