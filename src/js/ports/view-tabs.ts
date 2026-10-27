/** A tab as the view shows it */
export interface ViewTab {
  id: number;
  windowId: number;
  // Place in the window, from the first
  index: number;
  title: string;
  url: string | undefined;
  favIconUrl: string | undefined;
  pinned: boolean;
  // Not loaded yet, since the browser started or the tab was put to sleep
  discarded: boolean;
  // Milliseconds since the epoch; 0 for a tab the browser has no time for
  lastAccessed: number;
}

/** The tabs of the window the view is in */
export interface ViewTabs {
  /** The tabs of the window, in the order the browser has them */
  list(): Promise<ViewTab[]>;
  /** The tabs of every window; a tab the browser gives no id or window is left out */
  listAll(): Promise<ViewTab[]>;
  /** Rejects if the tab no longer exists */
  get(tabId: number): Promise<ViewTab>;
  activate(tabId: number): Promise<void>;
  /** Rejects if the tab is already closed */
  close(tabId: number): Promise<void>;
  /** Put the tab at a place in its window */
  moveTo(tabId: number, index: number): Promise<void>;
  /** Open a new tab, make it the active one, and give its id */
  openNew(): Promise<number>;
  /** The id of the tab the view is shown in */
  currentId(): Promise<number>;
  /** A picture of the tab as an image address; nothing if the browser cannot take one */
  capture(tabId: number): Promise<string | undefined>;
}
