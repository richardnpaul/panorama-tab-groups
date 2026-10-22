export interface Windows {
  /** The id of the window the code is running in */
  currentWindowId(): Promise<number>;
  /** The id of the window the user used last */
  lastFocusedWindowId(): Promise<number>;
  /** The ids of all the windows that are open */
  listIds(): Promise<number[]>;
  /** Whether the window is still open */
  exists(windowId: number): Promise<boolean>;
}
