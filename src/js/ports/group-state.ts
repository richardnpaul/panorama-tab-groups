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
  containerId: string;
  rect: Rect;
  windowId?: number;
  // The browser's own tab group, once one has been created for this group
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
  getGroups(windowId: number): Promise<Group[] | undefined>;
  setGroups(windowId: number, groups: readonly Group[]): Promise<void>;
  getActiveGroup(windowId: number): Promise<number | undefined>;
  setActiveGroup(windowId: number, groupId: number): Promise<void>;
  // The next unused group id of a window
  getGroupIndex(windowId: number): Promise<number | undefined>;
  setGroupIndex(windowId: number, index: number): Promise<void>;
  getTabGroup(tabId: number): Promise<number | undefined>;
  setTabGroup(tabId: number, groupId: number): Promise<void>;
  /** Forget which group a tab was in */
  clearTabGroup(tabId: number): Promise<void>;
}
