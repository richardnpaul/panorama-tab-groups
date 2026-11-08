export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A tab group as it is persisted per window */
export interface Group {
  id: number;
  name: string;
  // Written by versions before 2 of the stored data, and never read: a group has no container
  containerId?: string;
  rect: Rect;
  windowId?: number;
  // The browser's own tab group, once one has been linked to this group (see `setNativeGroupLink`);
  // `null` is kept with the group, for a group made with no native group yet
  nativeGroupId?: number | null;
  lastMoved?: number;
  isSystemGroup?: boolean;
  tabCount?: number;
}

/**
 * Where the extension keeps which groups exist, which one is active, and which
 * group each tab belongs to. Reads give `undefined` for anything never stored.
 */
export interface GroupState {
  /** The groups of a window, each with the link to its native group, if it has one */
  getGroups(windowId: number): Promise<Group[] | undefined>;
  /**
   * Store the groups of a window. A link to a native group is not stored with them: a caller that
   * read the groups before a link changed would write the old one back. Links of groups that are
   * not in the list are forgotten.
   */
  setGroups(windowId: number, groups: readonly Group[]): Promise<void>;
  /**
   * Link a group of a window to the browser's group that holds its tabs, or with none, forget the
   * link. Links last as long as the browser runs: its groups are found again after a restart.
   */
  setNativeGroupLink(
    windowId: number,
    groupId: number,
    nativeGroupId: number | undefined,
  ): Promise<void>;
  getActiveGroup(windowId: number): Promise<number | undefined>;
  setActiveGroup(windowId: number, groupId: number): Promise<void>;
  // The next unused group id of a window
  getGroupIndex(windowId: number): Promise<number | undefined>;
  setGroupIndex(windowId: number, index: number): Promise<void>;
  getTabGroup(tabId: number): Promise<number | undefined>;
  setTabGroup(tabId: number, groupId: number): Promise<void>;
  /** Forget which group a tab was in */
  clearTabGroup(tabId: number): Promise<void>;
  /** The version of the shape of what is stored for a window and its tabs; none before version 2 */
  getSchemaVersion(windowId: number): Promise<number | undefined>;
  setSchemaVersion(windowId: number, version: number): Promise<void>;
  /**
   * The ids of the windows and of the tabs that values are kept under, open or closed. Only a
   * browser whose values do not go with their window or tab (Chromium) has any to give: the
   * other gives none, and `forgetWindow`, `forgetTab` and `setClosedAt` do nothing there.
   */
  listStoredWindowIds(): Promise<number[]>;
  listStoredTabIds(): Promise<number[]>;
  /**
   * The ids of the private (incognito) windows and tabs whose values are kept apart from those
   * above, so that none of them is kept for a window that comes back (Chromium only: the other
   * browser drops a private window's values itself). They are on disk until they are forgotten.
   */
  listPrivateWindowIds(): Promise<number[]>;
  listPrivateTabIds(): Promise<number[]>;
  /**
   * Keep the values of these open private windows and tabs apart from now on.
   * TEMPORARY: only for values the versions before private ones were kept apart stored with the others; to be removed (see
   * the plan `docs/plans/data-structures-review.md`, F11).
   */
  setPrivate(
    windowIds: readonly number[],
    tabIds: readonly number[],
  ): Promise<void>;
  /**
   * Forget every value of a window (with the links of its groups to native tab groups), or of a
   * tab
   */
  forgetWindow(windowId: number): Promise<void>;
  forgetTab(tabId: number): Promise<void>;
  /** When a window was closed, in milliseconds since the epoch; none while it is open or not known */
  getClosedAt(windowId: number): Promise<number | undefined>;
  setClosedAt(windowId: number, at: number): Promise<void>;
}
