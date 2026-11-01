/** The colours the browser gives its tab groups */
export type NativeGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';

/** The browser's own tab groups */
export interface NativeGroups {
  /** Rejects if the group no longer exists */
  setCollapsed(nativeGroupId: number, collapsed: boolean): Promise<void>;
  /** The ids of the groups in a window */
  listIdsInWindow(windowId: number): Promise<number[]>;
  /** The ids of the tabs in a group */
  tabIdsIn(nativeGroupId: number): Promise<number[]>;
  /**
   * Put the tabs, which are all in this window, in a new group in it, and give
   * back its id. The window has to be said: left to itself the browser makes the
   * group in the window that has the focus, and moves the tabs there.
   */
  createFromTabs(tabIds: readonly number[], windowId: number): Promise<number>;
  /** Put the tabs in an existing group */
  addTabs(tabIds: readonly number[], nativeGroupId: number): Promise<void>;
  /** Take the tabs out of whatever native group they are in */
  removeTabs(tabIds: readonly number[]): Promise<void>;
  setAppearance(
    nativeGroupId: number,
    appearance: { title: string; color: NativeGroupColor | undefined },
  ): Promise<void>;
  /** What a group is like now; rejects if it no longer exists */
  get(nativeGroupId: number): Promise<{
    windowId: number;
    title: string | undefined;
  }>;
}
