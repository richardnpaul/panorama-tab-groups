import type { ViewTab, ViewTabs } from '../../ports/view-tabs.js';

export interface MemoryViewTabs extends ViewTabs {
  /** Replace the tabs of the window */
  setTabs(tabs: readonly ViewTab[]): void;
  /** What was done, in order: `activate 3`, `close 4`, `move 2 to 0`, `open new` */
  readonly calls: string[];
  /** The id of the tab the view is shown in */
  currentTabId: number;
  /** The id the next tab made by `openNew` gets */
  nextTabId: number;
  /** The pictures `capture` gives, by tab; none for a browser that cannot */
  readonly captures: Map<number, string>;
}

/** The tabs of a window, kept in memory */
export function createMemoryViewTabs(
  initial: readonly ViewTab[] = [],
): MemoryViewTabs {
  let tabs = initial.map((tab) => ({ ...tab }));
  const calls: string[] = [];
  const captures = new Map<number, string>();

  const find = (tabId: number): ViewTab | undefined =>
    tabs.find(({ id }) => id === tabId);

  const self: MemoryViewTabs = {
    calls,
    captures,
    currentTabId: 1,
    nextTabId: 500,
    setTabs(next) {
      tabs = next.map((tab) => ({ ...tab }));
    },
    list: () => Promise.resolve(tabs.map((tab) => ({ ...tab }))),
    get(tabId) {
      const found = find(tabId);
      return found === undefined
        ? Promise.reject(new Error(`Invalid tab ID: ${String(tabId)}`))
        : Promise.resolve({ ...found });
    },
    activate(tabId) {
      calls.push(`activate ${String(tabId)}`);
      return Promise.resolve();
    },
    close(tabId) {
      calls.push(`close ${String(tabId)}`);
      if (find(tabId) === undefined) {
        return Promise.reject(new Error(`Invalid tab ID: ${String(tabId)}`));
      }
      tabs = tabs.filter(({ id }) => id !== tabId);
      return Promise.resolve();
    },
    moveTo(tabId, index) {
      calls.push(`move ${String(tabId)} to ${String(index)}`);
      return Promise.resolve();
    },
    openNew() {
      calls.push('open new');
      const id = self.nextTabId;
      self.nextTabId += 1;
      return Promise.resolve(id);
    },
    currentId: () => Promise.resolve(self.currentTabId),
    capture: (tabId) => Promise.resolve(captures.get(tabId)),
  };
  return self;
}
