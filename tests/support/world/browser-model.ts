/**
 * A browser, as far as tabs, windows and tab groups go, with the behaviour that
 * the real Firefox was seen to have (`tests/e2e/firefox-facts.spec.ts` checks each
 * of those facts against a real one, and this file says which it follows):
 *
 * - a tab group is made in the window it is told to, or else in the window that has
 *   the focus, and tabs of any other window are **moved** there
 * - a tab can only join a group by its id when it is in the window of the group
 * - a group has no tabs when its last tab is taken out or closed, and then it is gone
 * - a tab that is moved to another window leaves its group
 * - the active tab is not hidden
 * - when the tab in front of a window leaves it or is closed, the next one comes to the front, and the
 *   browser says it was activated
 * - the ids of tab groups are large numbers
 * - a window that was closed is restored with new ids for it and its tabs, its tab groups with
 *   their ids, names and colours, and the values the extension kept with it and its tabs
 *
 * It tells what happens as events, which a test world hands to the extension as the
 * browser does. The values of the extension's session are kept on its tabs and windows
 * and go with them, as the browser's do.
 */

export interface ModelTab {
  id: number;
  windowId: number;
  url: string;
  title: string;
  active: boolean;
  pinned: boolean;
  hidden: boolean;
  /** The id of the tab's native group, or -1 */
  groupId: number;
  /** What the extension keeps with the tab */
  values: Record<string, unknown>;
}

interface ModelWindow {
  id: number;
  /** The ids of its tabs, in the order of the window */
  tabIds: number[];
  values: Record<string, unknown>;
}

export interface ModelGroup {
  id: number;
  windowId: number;
  title: string;
  color: string | undefined;
  collapsed: boolean;
}

export type BrowserEvent =
  | { type: 'windowCreated'; windowId: number }
  | { type: 'tabCreated'; tab: ModelTab }
  | { type: 'tabAttached'; tabId: number; windowId: number }
  | { type: 'tabDetached'; tabId: number }
  | { type: 'tabActivated'; tabId: number }
  | { type: 'tabUpdated'; tab: ModelTab; change: { groupId?: number } }
  | { type: 'tabRemoved'; tabId: number }
  | { type: 'groupRemoved'; group: ModelGroup }
  | { type: 'groupUpdated'; group: ModelGroup };

/** What a tab group is told: where to be made, or which one to join */
interface GroupTarget {
  windowId?: number | undefined;
  groupId?: number | undefined;
}

export interface BrowserModel {
  readonly windows: ReadonlyMap<number, ModelWindow>;
  readonly tabs: ReadonlyMap<number, ModelTab>;
  readonly groups: ReadonlyMap<number, ModelGroup>;
  /** The window that has the focus */
  focused(): number;
  tabsOf(windowId: number): ModelTab[];

  /** A window and its tabs as they were before the extension ran: nothing is told */
  seedWindow(urls: readonly string[]): { windowId: number; tabIds: number[] };
  openWindow(urls: readonly string[]): { windowId: number; tabIds: number[] };
  openTab(windowId: number, url: string, active?: boolean): number;
  activateTab(tabId: number): void;
  closeTab(tabId: number): void;
  /** Close a window with all its tabs, which can be restored */
  closeWindow(windowId: number): void;
  /** Open again the window that was closed last, as the browser does for "Undo close window" */
  restoreWindow(): { windowId: number; tabIds: number[] } | undefined;
  moveTab(tabId: number, windowId: number): void;
  moveToEnd(tabId: number): void;
  focusWindow(windowId: number): void;

  group(tabIds: readonly number[], target?: GroupTarget): number;
  ungroup(tabIds: readonly number[]): void;
  updateGroup(
    groupId: number,
    changes: { title?: string; color?: string; collapsed?: boolean },
  ): void;
  hide(tabIds: readonly number[]): number[];
  show(tabIds: readonly number[]): void;

  /** The browser is closed and opened again: windows, tabs and groups have new ids, and keep what they hold */
  restart(): void;
}

// A moment in time in microseconds, as the ids of tab groups are
const GROUP_ID_BASE = 1_793_000_000_000_000;
const GROUP_ID_STEP = 1_017;

const missing = (what: string, id: number): Error =>
  new Error(`No ${what} with id: ${String(id)}`);

/** What the browser keeps of a window that was closed */
interface ClosedWindow {
  values: Record<string, unknown>;
  tabs: {
    url: string;
    title: string;
    pinned: boolean;
    hidden: boolean;
    active: boolean;
    values: Record<string, unknown>;
    group: ModelGroup | undefined;
  }[];
}

export function createBrowserModel(
  emit: (event: BrowserEvent) => void,
): BrowserModel {
  let windows = new Map<number, ModelWindow>();
  let tabs = new Map<number, ModelTab>();
  let groups = new Map<number, ModelGroup>();
  let focusedWindow = 0;
  let nextWindowId = 1;
  let nextTabId = 1;
  let nextGroupId = GROUP_ID_BASE;
  let restarts = 0;
  const recentlyClosed: ClosedWindow[] = [];

  const windowOf = (windowId: number): ModelWindow => {
    const found = windows.get(windowId);
    if (found === undefined) {
      throw missing('window', windowId);
    }
    return found;
  };

  const tabOf = (tabId: number): ModelTab => {
    const found = tabs.get(tabId);
    if (found === undefined) {
      throw missing('tab', tabId);
    }
    return found;
  };

  const tabsOf = (windowId: number): ModelTab[] =>
    windowOf(windowId).tabIds.map(tabOf);

  const newGroupId = (): number => {
    nextGroupId += GROUP_ID_STEP;
    return nextGroupId;
  };

  /** A group that has no tabs is gone */
  function dropGroupIfEmpty(groupId: number): void {
    const group = groups.get(groupId);
    if (
      group !== undefined &&
      ![...tabs.values()].some((tab) => tab.groupId === groupId)
    ) {
      groups.delete(groupId);
      emit({ type: 'groupRemoved', group });
    }
  }

  function setGroupOf(tab: ModelTab, groupId: number): void {
    const previous = tab.groupId;
    if (previous === groupId) {
      return;
    }
    tab.groupId = groupId;
    emit({ type: 'tabUpdated', tab, change: { groupId } });
    if (previous !== -1) {
      dropGroupIfEmpty(previous);
    }
  }

  function addWindow(urls: readonly string[]): {
    window: ModelWindow;
    created: ModelTab[];
  } {
    const window: ModelWindow = {
      id: nextWindowId,
      tabIds: [],
      values: {},
    };
    nextWindowId += 1;
    windows.set(window.id, window);
    const created = (urls.length === 0 ? ['about:blank'] : urls).map(
      (url, position) => {
        const tab: ModelTab = {
          id: nextTabId,
          windowId: window.id,
          url,
          title: url,
          active: position === 0,
          pinned: false,
          hidden: false,
          groupId: -1,
          values: {},
        };
        nextTabId += 1;
        tabs.set(tab.id, tab);
        window.tabIds.push(tab.id);
        return tab;
      },
    );
    return { window, created };
  }

  // A window with no tab left is closed
  function closeWindowIfEmpty(windowId: number): void {
    const window = windows.get(windowId);
    if (window?.tabIds.length === 0) {
      windows.delete(windowId);
      if (focusedWindow === windowId) {
        focusedWindow = [...windows.keys()][0] ?? 0;
      }
    }
  }

  function detach(tab: ModelTab): void {
    const window = windowOf(tab.windowId);
    window.tabIds = window.tabIds.filter((id) => id !== tab.id);
    // The next tab of the window comes to the front, as it does when the active one leaves, and
    // the browser says so
    if (tab.active) {
      tab.active = false;
      const [next] = window.tabIds.map(tabOf);
      if (next !== undefined) {
        next.active = true;
        emit({ type: 'tabActivated', tabId: next.id });
      }
    }
  }

  function moveBetweenWindows(tab: ModelTab, windowId: number): void {
    const from = tab.windowId;
    const target = windowOf(windowId);
    emit({ type: 'tabDetached', tabId: tab.id });
    detach(tab);
    tab.windowId = windowId;
    tab.active = false;
    target.tabIds.push(tab.id);
    // A tab that goes to another window leaves its group
    const left = tab.groupId;
    tab.groupId = -1;
    emit({ type: 'tabAttached', tabId: tab.id, windowId });
    if (left !== -1) {
      emit({ type: 'tabUpdated', tab, change: { groupId: -1 } });
      dropGroupIfEmpty(left);
    }
    closeWindowIfEmpty(from);
  }

  const model: BrowserModel = {
    get windows() {
      return windows;
    },
    get tabs() {
      return tabs;
    },
    get groups() {
      return groups;
    },
    focused: () => focusedWindow,
    tabsOf,

    seedWindow(urls) {
      const { window, created } = addWindow(urls);
      focusedWindow = window.id;
      return { windowId: window.id, tabIds: created.map(({ id }) => id) };
    },

    openWindow(urls) {
      const { window, created } = addWindow(urls);
      focusedWindow = window.id;
      emit({ type: 'windowCreated', windowId: window.id });
      created.forEach((tab) => {
        emit({ type: 'tabCreated', tab });
      });
      return { windowId: window.id, tabIds: created.map(({ id }) => id) };
    },

    openTab(windowId, url, active = false) {
      const window = windowOf(windowId);
      const tab: ModelTab = {
        id: nextTabId,
        windowId,
        url,
        title: url,
        active: false,
        pinned: false,
        hidden: false,
        groupId: -1,
        values: {},
      };
      nextTabId += 1;
      tabs.set(tab.id, tab);
      window.tabIds.push(tab.id);
      emit({ type: 'tabCreated', tab });
      if (active) {
        model.activateTab(tab.id);
      }
      return tab.id;
    },

    activateTab(tabId) {
      const tab = tabOf(tabId);
      if (tab.active) {
        return;
      }
      tabsOf(tab.windowId).forEach((each) => {
        each.active = each.id === tabId;
      });
      tab.hidden = false;
      emit({ type: 'tabActivated', tabId });
    },

    closeTab(tabId) {
      const tab = tabOf(tabId);
      const { groupId, windowId } = tab;
      detach(tab);
      tabs.delete(tabId);
      emit({ type: 'tabRemoved', tabId });
      if (groupId !== -1) {
        dropGroupIfEmpty(groupId);
      }
      closeWindowIfEmpty(windowId);
    },

    closeWindow(windowId) {
      const window = windowOf(windowId);
      recentlyClosed.push({
        values: structuredClone(window.values),
        tabs: tabsOf(windowId).map((tab) => ({
          url: tab.url,
          title: tab.title,
          pinned: tab.pinned,
          hidden: tab.hidden,
          active: tab.active,
          values: structuredClone(tab.values),
          group: groups.get(tab.groupId),
        })),
      });
      // A window closes as a whole: no tab in it is brought to the front as another is closed
      [...window.tabIds].forEach((tabId) => {
        tabs.delete(tabId);
        emit({ type: 'tabRemoved', tabId });
      });
      [...groups.values()]
        .filter((group) => group.windowId === windowId)
        .forEach((group) => {
          groups.delete(group.id);
          emit({ type: 'groupRemoved', group });
        });
      windows.delete(windowId);
      if (focusedWindow === windowId) {
        focusedWindow = [...windows.keys()][0] ?? 0;
      }
    },

    restoreWindow() {
      const closed = recentlyClosed.pop();
      if (closed === undefined) {
        return undefined;
      }
      const { window, created } = addWindow(closed.tabs.map(({ url }) => url));
      window.values = structuredClone(closed.values);
      focusedWindow = window.id;
      emit({ type: 'windowCreated', windowId: window.id });
      created.forEach((tab, position) => {
        const saved = closed.tabs[position];
        if (saved !== undefined) {
          Object.assign(tab, {
            title: saved.title,
            pinned: saved.pinned,
            hidden: saved.hidden,
            active: saved.active,
            values: structuredClone(saved.values),
          });
          // The group comes back with the id, name and colour it had
          if (saved.group !== undefined) {
            groups.set(saved.group.id, {
              ...saved.group,
              windowId: window.id,
            });
            tab.groupId = saved.group.id;
          }
        }
        emit({ type: 'tabCreated', tab });
      });
      return { windowId: window.id, tabIds: created.map(({ id }) => id) };
    },

    moveTab(tabId, windowId) {
      const tab = tabOf(tabId);
      if (tab.windowId !== windowId) {
        moveBetweenWindows(tab, windowId);
      }
    },

    moveToEnd(tabId) {
      const tab = tabOf(tabId);
      const window = windowOf(tab.windowId);
      window.tabIds = [...window.tabIds.filter((id) => id !== tabId), tabId];
    },

    focusWindow(windowId) {
      windowOf(windowId);
      focusedWindow = windowId;
    },

    group(tabIds, target = {}) {
      if (tabIds.length === 0) {
        throw new Error(
          'Type error for parameter options (Error processing tabIds: Value must either: be an integer value, or have at least 1 items) for tabs.group.',
        );
      }
      const members = tabIds.map(tabOf);

      if (target.groupId !== undefined) {
        const group = groups.get(target.groupId);
        if (group === undefined) {
          throw missing('group', target.groupId);
        }
        // Joining a group by its id works for the tabs of its window only
        if (members.some(({ windowId }) => windowId !== group.windowId)) {
          throw new Error('An unexpected error occurred');
        }
        members.forEach((tab) => {
          setGroupOf(tab, group.id);
        });
        return group.id;
      }

      // Not said where, the group is made in the window that has the focus
      const windowId = target.windowId ?? focusedWindow;
      windowOf(windowId);
      members
        .filter((tab) => tab.windowId !== windowId)
        .forEach((tab) => {
          moveBetweenWindows(tab, windowId);
        });
      const id = newGroupId();
      groups.set(id, {
        id,
        windowId,
        title: '',
        color: 'grey',
        collapsed: false,
      });
      members.forEach((tab) => {
        setGroupOf(tab, id);
      });
      return id;
    },

    ungroup(tabIds) {
      tabIds.map(tabOf).forEach((tab) => {
        setGroupOf(tab, -1);
      });
    },

    updateGroup(groupId, changes) {
      const group = groups.get(groupId);
      if (group === undefined) {
        throw missing('group', groupId);
      }
      Object.assign(group, changes);
      emit({ type: 'groupUpdated', group });
    },

    hide(tabIds) {
      // The active tab is not hidden
      const hidden = tabIds.map(tabOf).filter((tab) => !tab.active);
      hidden.forEach((tab) => {
        tab.hidden = true;
      });
      return hidden.map(({ id }) => id);
    },

    show(tabIds) {
      tabIds.map(tabOf).forEach((tab) => {
        tab.hidden = false;
      });
    },

    restart() {
      restarts += 1;
      const windowIds = new Map<number, number>();
      const tabIds = new Map<number, number>();
      const groupIds = new Map<number, number>();
      const bump = restarts * 1000;

      const newTabs = new Map<number, ModelTab>();
      const newWindows = new Map<number, ModelWindow>();
      [...windows.values()].forEach((window) => {
        const id = bump + window.id;
        windowIds.set(window.id, id);
        newWindows.set(id, { ...window, id, tabIds: [] });
      });
      [...groups.values()].forEach((group) => {
        groupIds.set(group.id, newGroupId());
      });
      [...windows.values()].forEach((window) => {
        window.tabIds.map(tabOf).forEach((tab) => {
          const id = bump + tab.id;
          tabIds.set(tab.id, id);
          const windowId = windowIds.get(window.id) ?? 0;
          newTabs.set(id, {
            ...tab,
            id,
            windowId,
            groupId: groupIds.get(tab.groupId) ?? -1,
          });
          newWindows.get(windowId)?.tabIds.push(id);
        });
      });
      const newGroups = new Map<number, ModelGroup>();
      [...groups.values()].forEach((group) => {
        const id = groupIds.get(group.id) ?? 0;
        newGroups.set(id, {
          ...group,
          id,
          windowId: windowIds.get(group.windowId) ?? 0,
        });
      });

      windows = newWindows;
      tabs = newTabs;
      groups = newGroups;
      focusedWindow = windowIds.get(focusedWindow) ?? 0;
      nextWindowId = bump + nextWindowId;
      nextTabId = bump + nextTabId;
    },
  };
  return model;
}
