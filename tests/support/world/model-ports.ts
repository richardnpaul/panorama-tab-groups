import type { SessionsApi } from '../../../src/js/adapters/browser/group-state.js';
import type { NativeGroups } from '../../../src/js/ports/native-groups.js';
import type { TabDetails, Tabs } from '../../../src/js/ports/tabs.js';
import type { Windows } from '../../../src/js/ports/windows.js';
import type { BrowserModel, ModelTab } from './browser-model.js';

/** What the extension is told of a tab */
const detailsOf = ({
  id,
  windowId,
  active,
  pinned,
  url,
  title,
  groupId,
}: ModelTab): TabDetails => ({
  id,
  windowId,
  active,
  pinned,
  url,
  pendingUrl: undefined,
  title,
  browserGroupId: groupId,
});

const rejected = <T>(work: () => T): Promise<T> => {
  try {
    return Promise.resolve(work());
  } catch (error) {
    return Promise.reject(
      error instanceof Error ? error : new Error(String(error)),
    );
  }
};

/** The tabs of the model, as the extension asks for them */
export function tabsOfModel(model: BrowserModel): Tabs {
  const tab = (id: number): ModelTab => {
    const found = model.tabs.get(id);
    if (found === undefined) {
      throw new Error(`Invalid tab ID: ${String(id)}`);
    }
    return found;
  };
  const inWindow = (windowId: number): ModelTab[] => {
    if (!model.windows.has(windowId)) {
      throw new Error(`Invalid window ID: ${String(windowId)}`);
    }
    return model.tabsOf(windowId);
  };

  return {
    listIdsInCurrentWindow: () =>
      rejected(() => inWindow(model.focused()).map(({ id }) => id)),
    listInCurrentWindow: () =>
      rejected(() =>
        inWindow(model.focused()).map(({ id, pinned }) => ({
          id,
          pinned,
          lastAccessed: 0,
        })),
      ),
    listSummariesInWindow: (windowId) =>
      rejected(() =>
        inWindow(windowId).map(({ id, pinned }) => ({
          id,
          pinned,
          lastAccessed: 0,
        })),
      ),
    get: (id) => rejected(() => detailsOf(tab(id))),
    listInWindow: (windowId) =>
      rejected(() => inWindow(windowId).map(detailsOf)),
    highlightedIdsInWindow: (windowId) =>
      rejected(() =>
        inWindow(windowId)
          .filter(({ active }) => active)
          .map(({ id }) => id),
      ),
    visibleIdsInWindow: (windowId) =>
      rejected(() =>
        inWindow(windowId)
          .filter(({ hidden }) => !hidden)
          .map(({ id }) => id),
      ),
    activate: (id) =>
      rejected(() => {
        model.activateTab(id);
      }),
    moveToEnd: (id) =>
      rejected(() => {
        model.moveToEnd(id);
      }),
    close: (id) =>
      rejected(() => {
        model.closeTab(id);
      }),
    snapshotsInWindow: (windowId) =>
      rejected(() =>
        inWindow(windowId).map(({ id, url, title, pinned }, index) => ({
          id,
          url,
          title,
          index,
          lastAccessed: 0,
          pinned,
        })),
      ),
    create: ({ url, windowId, active }) =>
      rejected(() => model.openTab(windowId, url, active)),
    open: (url, active) =>
      rejected(() => model.openTab(model.focused(), url, active)),
    hide: (ids) =>
      rejected(() => {
        model.hide(ids);
      }),
    show: (ids) =>
      rejected(() => {
        model.show(ids);
      }),
  };
}

/** The windows of the model */
export function windowsOfModel(model: BrowserModel): Windows {
  return {
    currentWindowId: () => Promise.resolve(model.focused()),
    lastFocusedWindowId: () => Promise.resolve(model.focused()),
    create: () => Promise.resolve(model.openWindow([]).windowId),
    place: () => Promise.resolve(),
    listIds: () => Promise.resolve([...model.windows.keys()]),
    exists: (windowId) => Promise.resolve(model.windows.has(windowId)),
  };
}

/** The tab groups of the model, as the extension asks for them */
export function nativeGroupsOfModel(model: BrowserModel): NativeGroups {
  const group = (id: number) => {
    const found = model.groups.get(id);
    if (found === undefined) {
      throw new Error(`No group with id: ${String(id)}`);
    }
    return found;
  };
  return {
    setCollapsed: (id, collapsed) =>
      rejected(() => {
        group(id);
        model.updateGroup(id, { collapsed });
      }),
    listIdsInWindow: (windowId) =>
      Promise.resolve(
        [...model.groups.values()]
          .filter((each) => each.windowId === windowId)
          .map(({ id }) => id),
      ),
    tabIdsIn: (id) =>
      Promise.resolve(
        [...model.tabs.values()]
          .filter((tab) => tab.groupId === id)
          .map((tab) => tab.id),
      ),
    createFromTabs: (tabIds, windowId) =>
      rejected(() => model.group(tabIds, { windowId })),
    addTabs: (tabIds, id) =>
      rejected(() => {
        model.group(tabIds, { groupId: id });
      }),
    removeTabs: (tabIds) =>
      rejected(() => {
        model.ungroup(tabIds);
      }),
    setAppearance: (id, { title, color }) =>
      rejected(() => {
        group(id);
        model.updateGroup(
          id,
          color === undefined ? { title } : { title, color },
        );
      }),
    get: (id) =>
      rejected(() => {
        const { windowId, title } = group(id);
        return { windowId, title };
      }),
  };
}

/** `browser.sessions`: values kept with a tab or a window, which go when it goes */
export function sessionsOfModel(model: BrowserModel): SessionsApi {
  const tab = (id: number): ModelTab => {
    const found = model.tabs.get(id);
    if (found === undefined) {
      throw new Error(`Invalid tab ID: ${String(id)}`);
    }
    return found;
  };
  const window = (id: number) => {
    const found = model.windows.get(id);
    if (found === undefined) {
      throw new Error(`Invalid window ID: ${String(id)}`);
    }
    return found;
  };
  return {
    sessions: {
      getWindowValue: (windowId, key) =>
        rejected(() => structuredClone(window(windowId).values[key])),
      setWindowValue: (windowId, key, value) =>
        rejected(() => {
          window(windowId).values[key] = structuredClone(value);
        }),
      getTabValue: (tabId, key) =>
        rejected(() => structuredClone(tab(tabId).values[key])),
      setTabValue: (tabId, key, value) =>
        rejected(() => {
          tab(tabId).values[key] = structuredClone(value);
        }),
      removeTabValue: (tabId, key) =>
        rejected(() => {
          Reflect.deleteProperty(tab(tabId).values, key);
        }),
    },
  };
}
