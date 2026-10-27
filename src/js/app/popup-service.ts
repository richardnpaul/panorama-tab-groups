import { gridRect, mostRecent } from '../core/popup.js';
import type { GroupState } from '../ports/group-state.js';
import type { ViewTab, ViewTabs } from '../ports/view-tabs.js';
import type { GroupsStore } from './groups-store.js';

/** A group of the window as the popup lists it, with the tabs that are in it */
export interface PopupGroup {
  id: number;
  name: string;
  tabs: ViewTab[];
}

export interface PopupSnapshot {
  groups: PopupGroup[];
  /** The tab used last, and the group it is in, to be marked in the lists */
  lastUsed: { tabId: number; groupId: number | undefined } | null;
}

export interface PopupServiceDeps {
  groups: Pick<
    GroupsStore,
    | 'getIds'
    | 'get'
    | 'forEach'
    | 'getLength'
    | 'create'
    | 'remove'
    | 'rename'
    | 'transform'
    | 'moveTo'
    | 'setActive'
  >;
  groupState: Pick<GroupState, 'getTabGroup' | 'setTabGroup'>;
  tabs: Pick<ViewTabs, 'list' | 'activate' | 'close' | 'openNew'>;
}

export interface PopupService {
  snapshot(): Promise<PopupSnapshot>;
  /** Go to the group: to its first tab, or to a new tab if it has none */
  showGroup(groupId: number): Promise<void>;
  addNewTab(groupId: number): Promise<void>;
  /** Make a group in the next place of the grid, and say its id */
  createGroup(): Promise<number>;
  /** Whether the group is gone; if so, the first of those left is shown */
  removeGroup(groupId: number): Promise<boolean>;
  renameGroup(groupId: number, name: string): Promise<void>;
  moveGroup(groupId: number, gap: number): Promise<void>;
  openTab(tabId: number): Promise<void>;
  closeTab(tabId: number): Promise<void>;
}

export function createPopupService({
  groups,
  groupState,
  tabs,
}: PopupServiceDeps): PopupService {
  async function snapshot(): Promise<PopupSnapshot> {
    const all = await tabs.list();
    const tabGroups = await Promise.all(
      all.map(({ id }) => groupState.getTabGroup(id)),
    );
    const groupOf = new Map(all.map(({ id }, place) => [id, tabGroups[place]]));

    // Pinned tabs are in no group
    const unpinned = all.filter(({ pinned }) => !pinned);
    const used = mostRecent(all);
    const listed: PopupGroup[] = [];
    groups.forEach(({ id, name }) => {
      listed.push({
        id,
        name,
        tabs: unpinned.filter((tab) => groupOf.get(tab.id) === id),
      });
    });
    return {
      groups: listed,
      lastUsed:
        used === null
          ? null
          : { tabId: used.id, groupId: groupOf.get(used.id) },
    };
  }

  async function addNewTab(groupId: number): Promise<void> {
    await groups.setActive(groupId);
    const tabId = await tabs.openNew();
    await groupState.setTabGroup(tabId, groupId);
  }

  async function showGroup(groupId: number): Promise<void> {
    const group = (await snapshot()).groups.find(({ id }) => id === groupId);
    if (group === undefined) {
      return;
    }
    const [first] = group.tabs;
    if (first === undefined) {
      await addNewTab(groupId);
      return;
    }
    await groups.setActive(groupId);
    await tabs.activate(first.id);
  }

  return {
    snapshot,
    showGroup,
    addNewTab,

    async createGroup() {
      const { id } = await groups.create();
      const count = groups.getLength();
      await groups.transform(id, gridRect(count - 1, count));
      await groups.setActive(id);
      return id;
    },

    async removeGroup(groupId) {
      await groups.remove(groupId);
      if (groups.get(groupId) !== null) {
        return false;
      }
      const [first] = groups.getIds();
      if (first !== undefined) {
        await showGroup(first);
      }
      return true;
    },

    renameGroup: (groupId, name) => groups.rename(groupId, name),
    moveGroup: (groupId, gap) => groups.moveTo(groupId, gap),
    openTab: (tabId) => tabs.activate(tabId),
    closeTab: (tabId) => tabs.close(tabId),
  };
}
