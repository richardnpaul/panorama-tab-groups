import type { Group, GroupState } from '../../ports/group-state.js';
import { isDataVersion } from '../../share/guards.js';

/** A group as it is stored: a link to a native group is kept apart; a `null` stays */
function withoutLink(group: Group): Group {
  const { nativeGroupId, ...rest } = group;
  return nativeGroupId === null ? { ...rest, nativeGroupId } : rest;
}

/**
 * Group state held in memory, with values copied in and out like the browser does. It keeps them
 * under the id of their window or tab, as the emulation of Chromium does, and so can list and
 * forget them.
 */
export function createMemoryGroupState(): GroupState {
  const groups = new Map<number, Group[]>();
  // The links to native groups, by window, then by group
  const links = new Map<number, Map<number, number>>();
  const linksOf = (windowId: number): Map<number, number> => {
    const known = links.get(windowId) ?? new Map<number, number>();
    links.set(windowId, known);
    return known;
  };
  const activeGroups = new Map<number, number>();
  const groupIndexes = new Map<number, number>();
  const tabGroups = new Map<number, number>();
  const schemaVersions = new Map<number, number>();
  const closedAts = new Map<number, number>();

  return {
    getGroups: (windowId) => {
      const linked = links.get(windowId);
      return Promise.resolve(
        structuredClone(
          groups.get(windowId)?.map((group) => {
            const link = linked?.get(group.id);
            return link === undefined
              ? group
              : { ...group, nativeGroupId: link };
          }),
        ),
      );
    },
    setGroups: (windowId, toStore) => {
      groups.set(windowId, structuredClone(toStore.map(withoutLink)));
      const kept = new Set(toStore.map(({ id }) => id));
      const linked = linksOf(windowId);
      [...linked.keys()]
        .filter((groupId) => !kept.has(groupId))
        .forEach((groupId) => {
          linked.delete(groupId);
        });
      return Promise.resolve();
    },
    setNativeGroupLink: (windowId, groupId, nativeGroupId) => {
      if (nativeGroupId === undefined) {
        linksOf(windowId).delete(groupId);
      } else {
        linksOf(windowId).set(groupId, nativeGroupId);
      }
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
    clearTabGroup: (tabId) => {
      tabGroups.delete(tabId);
      return Promise.resolve();
    },
    getSchemaVersion: (windowId) => {
      const version = schemaVersions.get(windowId);
      return Promise.resolve(isDataVersion(version) ? version : undefined);
    },
    setSchemaVersion: (windowId, version) => {
      schemaVersions.set(windowId, version);
      return Promise.resolve();
    },
    listStoredWindowIds: () =>
      Promise.resolve([
        ...new Set([
          ...groups.keys(),
          ...activeGroups.keys(),
          ...groupIndexes.keys(),
          ...schemaVersions.keys(),
          ...closedAts.keys(),
        ]),
      ]),
    listStoredTabIds: () => Promise.resolve([...tabGroups.keys()]),
    // It keeps nothing past the session, so nothing apart
    listPrivateWindowIds: () => Promise.resolve([]),
    listPrivateTabIds: () => Promise.resolve([]),
    setPrivate: () => Promise.resolve(),
    forgetWindow: (windowId) => {
      groups.delete(windowId);
      links.delete(windowId);
      activeGroups.delete(windowId);
      groupIndexes.delete(windowId);
      schemaVersions.delete(windowId);
      closedAts.delete(windowId);
      return Promise.resolve();
    },
    forgetTab: (tabId) => {
      tabGroups.delete(tabId);
      return Promise.resolve();
    },
    getClosedAt: (windowId) => Promise.resolve(closedAts.get(windowId)),
    setClosedAt: (windowId, at) => {
      closedAts.set(windowId, at);
      return Promise.resolve();
    },
  };
}
