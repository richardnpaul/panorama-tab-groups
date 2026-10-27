export interface TabSummary {
  id: number;
  pinned: boolean;
  /** Milliseconds since the epoch; 0 for a tab the browser has no time for */
  lastAccessed: number;
}

/** What is known about a tab when it is created, attached or activated */
export interface TabDetails {
  id: number;
  windowId: number;
  active: boolean;
  pinned: boolean;
  url: string | undefined;
  pendingUrl: string | undefined;
  title: string | undefined;
  // The browser's own tab group of the tab; -1 means it is in none
  browserGroupId: number | undefined;
}

/** What a backup keeps of a tab */
export interface TabSnapshot {
  id: number;
  url: string | undefined;
  title: string | undefined;
  // Place in the window, from the first
  index: number;
  // Milliseconds since the epoch; 0 for a tab the browser has no time for
  lastAccessed: number;
  pinned: boolean;
}

export interface Tabs {
  /** The ids of the tabs in the window the code is running in */
  listIdsInCurrentWindow(): Promise<number[]>;
  /** The tabs of that window, in the order the browser has them */
  listInCurrentWindow(): Promise<TabSummary[]>;
  /** Rejects if the tab no longer exists */
  get(tabId: number): Promise<TabDetails>;
  listInWindow(windowId: number): Promise<TabDetails[]>;
  /** The ids of the tabs of a window the user has selected, the active one included */
  highlightedIdsInWindow(windowId: number): Promise<number[]>;
  /** The ids of the tabs of a window that are not hidden, in the browser's order */
  visibleIdsInWindow(windowId: number): Promise<number[]>;
  activate(tabId: number): Promise<void>;
  /** Put the tab after all the others of its window */
  moveToEnd(tabId: number): Promise<void>;
  /** Rejects if the tab is already closed */
  close(tabId: number): Promise<void>;
  /** The tabs of a window as a backup keeps them, in the order of the window */
  snapshotsInWindow(windowId: number): Promise<TabSnapshot[]>;
  /**
   * Open a page in a tab of a window, and give its id; rejects if the browser
   * refuses. A tab that is discarded is not loaded until it is used.
   */
  create(options: {
    url: string;
    windowId: number;
    active: boolean;
    discarded: boolean;
    pinned: boolean;
  }): Promise<number>;
  /** Open a page in a new tab in the window the code is running in */
  open(url: string, active: boolean): Promise<number>;
  /** Only browsers that can hide tabs (see Capabilities) support this */
  hide(tabIds: readonly number[]): Promise<void>;
  show(tabIds: readonly number[]): Promise<void>;
}
