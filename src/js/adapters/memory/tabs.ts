import type { TabDetails, Tabs, TabSummary } from '../../ports/tabs.js';

export interface MemoryTabs extends Tabs {
  /** Replace the tabs with plain tabs that have these ids */
  setIds(ids: readonly number[]): void;
  setTabs(tabs: readonly TabSummary[]): void;
  /** Make these tabs exist, whichever window they are in */
  setDetails(tabs: readonly TabDetails[]): void;
  /** Mark tabs as selected by the user, besides the active ones */
  setHighlighted(ids: readonly number[]): void;
  /** The window new tabs are opened in */
  openWindowId: number;
  /** The tabs that are hidden right now */
  readonly hiddenIds: Set<number>;
  /** What was done to the tabs, in order: `activate 3`, `hide 1,2`, `move 3`, `close 4`, `open url` */
  readonly calls: string[];
}

const plain = (id: number): TabSummary => ({
  id,
  pinned: false,
  lastAccessed: 0,
});

/** A window whose tabs are whatever it was told they are */
export function createMemoryTabs(
  initial: readonly (number | TabSummary)[] = [],
): MemoryTabs {
  let tabs = initial.map((tab) =>
    typeof tab === 'number' ? plain(tab) : { ...tab },
  );
  let details: TabDetails[] = [];
  const hiddenIds = new Set<number>();
  const highlighted = new Set<number>();
  let nextId = 9000;
  const calls: string[] = [];

  const inWindow = (windowId: number) =>
    details.filter((tab) => tab.windowId === windowId);

  const self: MemoryTabs = {
    hiddenIds,
    calls,
    openWindowId: 1,
    listIdsInCurrentWindow: () => Promise.resolve(tabs.map(({ id }) => id)),
    listInCurrentWindow: () => Promise.resolve(tabs.map((tab) => ({ ...tab }))),
    get(tabId) {
      const found = details.find(({ id }) => id === tabId);
      return found === undefined
        ? Promise.reject(new Error(`Invalid tab ID: ${String(tabId)}`))
        : Promise.resolve({ ...found });
    },
    listInWindow: (windowId) =>
      Promise.resolve(inWindow(windowId).map((tab) => ({ ...tab }))),
    highlightedIdsInWindow: (windowId) =>
      Promise.resolve(
        inWindow(windowId)
          .filter(({ id, active }) => active || highlighted.has(id))
          .map(({ id }) => id),
      ),
    visibleIdsInWindow: (windowId) =>
      Promise.resolve(
        inWindow(windowId)
          .filter(({ id }) => !hiddenIds.has(id))
          .map(({ id }) => id),
      ),
    activate(tabId) {
      calls.push(`activate ${String(tabId)}`);
      return Promise.resolve();
    },
    hide(tabIds) {
      calls.push(`hide ${tabIds.join(',')}`);
      tabIds.forEach((id) => hiddenIds.add(id));
      return Promise.resolve();
    },
    show(tabIds) {
      calls.push(`show ${tabIds.join(',')}`);
      tabIds.forEach((id) => hiddenIds.delete(id));
      return Promise.resolve();
    },
    moveToEnd(tabId) {
      calls.push(`move ${String(tabId)}`);
      const moved = details.filter(({ id }) => id === tabId);
      details = [...details.filter(({ id }) => id !== tabId), ...moved];
      return Promise.resolve();
    },
    close(tabId) {
      calls.push(`close ${String(tabId)}`);
      if (!details.some(({ id }) => id === tabId)) {
        return Promise.reject(new Error(`Invalid tab ID: ${String(tabId)}`));
      }
      details = details.filter(({ id }) => id !== tabId);
      return Promise.resolve();
    },
    open(url, active) {
      calls.push(`open ${url}`);
      const id = nextId;
      nextId += 1;
      details = [
        ...details,
        {
          id,
          windowId: self.openWindowId,
          active,
          pinned: false,
          url,
          pendingUrl: undefined,
          title: undefined,
          browserGroupId: undefined,
        },
      ];
      return Promise.resolve(id);
    },
    setHighlighted(ids) {
      highlighted.clear();
      ids.forEach((id) => highlighted.add(id));
    },
    setIds(ids) {
      tabs = ids.map(plain);
    },
    setDetails(next) {
      details = next.map((tab) => ({ ...tab }));
    },
    setTabs(next) {
      tabs = next.map((tab) => ({ ...tab }));
    },
  };
  return self;
}
