import type { NativeGroups } from '../../ports/native-groups.js';

export interface MemoryNativeGroup {
  windowId: number;
  tabIds: number[];
  title: string | undefined;
  color: string | undefined;
}

export interface MemoryNativeGroups extends NativeGroups {
  /** Whether each existing native group is collapsed */
  readonly collapsed: Map<number, boolean>;
  /** The groups that exist, by id */
  readonly groups: Map<number, MemoryNativeGroup>;
  /** What was done, in order: `collapse 3`, `expand 4`, `create 5:1,2` */
  readonly calls: string[];
  /** Make a group exist in a window with these tabs */
  seed(id: number, windowId: number, tabIds?: readonly number[]): void;
  /** Make the next creation of a group give this id (default: counting up) */
  nextId: number;
  /** Make the next group that is created appear in another window */
  moveNextGroupToWindow(windowId: number): void;
}

/** Native tab groups that exist only as the ids it was told about */
export function createMemoryNativeGroups(
  existingIds: readonly number[] = [],
  windowId = 1,
): MemoryNativeGroups {
  const collapsed = new Map(existingIds.map((id) => [id, false]));
  const groups = new Map<number, MemoryNativeGroup>(
    existingIds.map((id) => [
      id,
      { windowId, tabIds: [], title: undefined, color: undefined },
    ]),
  );
  const calls: string[] = [];
  let windowForNext: number | undefined;

  const missing = (id: number) => new Error(`No group with id: ${String(id)}`);

  const leaveGroups = (tabIds: readonly number[]) => {
    groups.forEach((group) => {
      group.tabIds = group.tabIds.filter((id) => !tabIds.includes(id));
    });
  };

  const self: MemoryNativeGroups = {
    collapsed,
    groups,
    calls,
    nextId: 1000,
    seed(id, groupWindowId, tabIds = []) {
      collapsed.set(id, false);
      groups.set(id, {
        windowId: groupWindowId,
        tabIds: [...tabIds],
        title: undefined,
        color: undefined,
      });
    },
    moveNextGroupToWindow(next) {
      windowForNext = next;
    },
    setCollapsed(nativeGroupId, shouldCollapse) {
      calls.push(
        `${shouldCollapse ? 'collapse' : 'expand'} ${String(nativeGroupId)}`,
      );
      if (!collapsed.has(nativeGroupId)) {
        return Promise.reject(missing(nativeGroupId));
      }
      collapsed.set(nativeGroupId, shouldCollapse);
      return Promise.resolve();
    },
    listIdsInWindow: (id) =>
      Promise.resolve(
        [...groups]
          .filter(([, group]) => group.windowId === id)
          .map(([key]) => key),
      ),
    tabIdsIn: (nativeGroupId) =>
      Promise.resolve([...(groups.get(nativeGroupId)?.tabIds ?? [])]),
    createFromTabs(tabIds, forWindow) {
      calls.push(`create ${tabIds.join(',')}`);
      const id = self.nextId;
      self.nextId += 1;
      leaveGroups(tabIds);
      groups.set(id, {
        windowId: windowForNext ?? forWindow,
        tabIds: [...tabIds],
        title: undefined,
        color: undefined,
      });
      collapsed.set(id, false);
      windowForNext = undefined;
      return Promise.resolve(id);
    },
    addTabs(tabIds, nativeGroupId) {
      calls.push(`add ${tabIds.join(',')} to ${String(nativeGroupId)}`);
      const group = groups.get(nativeGroupId);
      if (group === undefined) {
        return Promise.reject(missing(nativeGroupId));
      }
      leaveGroups(tabIds);
      group.tabIds.push(...tabIds);
      return Promise.resolve();
    },
    removeTabs(tabIds) {
      calls.push(`remove ${tabIds.join(',')}`);
      leaveGroups(tabIds);
      return Promise.resolve();
    },
    setAppearance(nativeGroupId, { title, color }) {
      calls.push(`appearance ${String(nativeGroupId)} ${title}`);
      const group = groups.get(nativeGroupId);
      if (group === undefined) {
        return Promise.reject(missing(nativeGroupId));
      }
      group.title = title;
      group.color = color;
      return Promise.resolve();
    },
    get(nativeGroupId) {
      const group = groups.get(nativeGroupId);
      return group === undefined
        ? Promise.reject(missing(nativeGroupId))
        : Promise.resolve({ windowId: group.windowId, title: group.title });
    },
  };
  return self;
}
