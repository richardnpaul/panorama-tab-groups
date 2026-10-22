import type { Group, GroupState } from '../../ports/group-state.js';

/** Group state held in memory, with values copied in and out like the browser does */
export function createMemoryGroupState(): GroupState {
  const groups = new Map<number, Group[]>();
  const activeGroups = new Map<number, number>();
  const groupIndexes = new Map<number, number>();
  const tabGroups = new Map<number, number>();

  return {
    getGroups: (windowId) =>
      Promise.resolve(structuredClone(groups.get(windowId))),
    setGroups: (windowId, toStore) => {
      groups.set(windowId, structuredClone([...toStore]));
      return Promise.resolve();
    },
    getActiveGroup: (windowId) => Promise.resolve(activeGroups.get(windowId)),
    setActiveGroup: (windowId, groupId) => {
      activeGroups.set(windowId, groupId);
      return Promise.resolve();
    },
    getGroupIndex: (windowId) => Promise.resolve(groupIndexes.get(windowId)),
    setGroupIndex: (windowId, index) => {
      groupIndexes.set(windowId, index);
      return Promise.resolve();
    },
    getTabGroup: (tabId) => Promise.resolve(tabGroups.get(tabId)),
    setTabGroup: (tabId, groupId) => {
      tabGroups.set(tabId, groupId);
      return Promise.resolve();
    },
  };
}
