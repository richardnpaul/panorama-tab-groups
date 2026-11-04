/** Where a window is on the screen, and how large; any of it may be unknown */
export interface WindowPlacement {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export interface Windows {
  /** The id of the window the code is running in */
  currentWindowId(): Promise<number>;
  /** The id of the window the user used last */
  lastFocusedWindowId(): Promise<number>;
  /** Open a new, empty window and give its id */
  create(): Promise<number>;
  /** Move and resize a window */
  place(windowId: number, placement: WindowPlacement): Promise<void>;
  /** The ids of all the windows that are open */
  listIds(): Promise<number[]>;
  /**
   * The ids of the windows that are open and not private (incognito), from one look at the
   * windows: a private window that opens meanwhile cannot slip in
   */
  listNonPrivateIds(): Promise<number[]>;
  /** The ids of the windows that are open and private, from one look at the windows */
  listPrivateIds(): Promise<number[]>;
  /** Whether the window is still open */
  exists(windowId: number): Promise<boolean>;
}
