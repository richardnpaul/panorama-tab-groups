import { nativeGroupIdOf } from '../core/groups.js';
import { groupIdOfMenuItem, neighbourOf } from '../core/menu-items.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Menus } from '../ports/menus.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';

const REFRESH_GROUPS = 'refresh-groups';

export interface TabMovesDeps {
  tabs: Pick<
    Tabs,
    | 'get'
    | 'moveToEnd'
    | 'activate'
    | 'highlightedIdsInWindow'
    | 'visibleIdsInWindow'
    | 'listInWindow'
  >;
  windows: Pick<Windows, 'currentWindowId'>;
  groupState: Pick<GroupState, 'setTabGroup' | 'getGroups' | 'getActiveGroup'>;
  nativeGroups: Pick<NativeGroups, 'addTabs' | 'removeTabs'>;
  menus: Pick<Menus, 'removeAll'>;
  // Make the menu items for the groups of the window again
  createMenuList: () => Promise<void>;
  toggleVisibleTabs: (activeGroup: number | undefined) => Promise<void>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  logger: Pick<Logger, 'debug' | 'warn'>;
}

/** What the browser says about the tab a context menu was opened on */
export interface ClickedTab {
  id?: number | undefined;
  windowId?: number | undefined;
}

export interface TabMoves {
  moveTab: (tabId: number, groupId: number) => Promise<void>;
  menuClicked: (
    info: { menuItemId: string | number },
    tab: ClickedTab | undefined,
  ) => Promise<void>;
}

export function createTabMoves({
  tabs,
  windows,
  groupState,
  nativeGroups,
  menus,
  createMenuList,
  toggleVisibleTabs,
  useNativeGroups,
  logger,
}: TabMovesDeps): TabMoves {
  // Only the active group has its tabs in a native group: the others have
  // theirs hidden, which would clash
  async function moveToNativeGroup(
    tabId: number,
    groupId: number,
    windowId: number,
    activeGroup: number | undefined,
  ): Promise<void> {
    const groups = await groupState.getGroups(windowId);
    const nativeGroupId = nativeGroupIdOf(
      groups?.find(({ id }) => id === groupId),
    );
    if (nativeGroupId === undefined) {
      return;
    }
    if (groupId === activeGroup) {
      await nativeGroups.addTabs([tabId], nativeGroupId);
    } else {
      await nativeGroups.removeTabs([tabId]);
    }
  }

  async function moveTab(tabId: number, groupId: number): Promise<void> {
    // Pinned tabs belong to no group, and moving one would unpin it
    if ((await tabs.get(tabId)).pinned) {
      logger.debug(`Ignored moving the pinned tab ${String(tabId)}`);
      return;
    }
    const windowId = await windows.currentWindowId();
    await groupState.setTabGroup(tabId, groupId);
    const activeGroup = await groupState.getActiveGroup(windowId);

    if (await useNativeGroups()) {
      try {
        await moveToNativeGroup(tabId, groupId, windowId, activeGroup);
      } catch (error) {
        // The tab may be gone, or the browser may have no native groups
        logger.warn('Could not assign tab to native group:', error);
      }
    }

    await tabs.moveToEnd(tabId);
    await toggleVisibleTabs(activeGroup);
  }

  // One after the other, so the tabs end up in the order they were in
  const moveAll = (tabIds: readonly number[], groupId: number): Promise<void> =>
    tabIds.reduce(
      (done, tabId) => done.then(() => moveTab(tabId, groupId)),
      Promise.resolve(),
    );

  // The tab that was clicked is the one that is shown, so when it is sent away
  // a neighbour takes over, rather than the window jumping to another group
  async function moveActiveTab(
    tabId: number,
    windowId: number,
    groupId: number,
  ): Promise<void> {
    const visible = await tabs.visibleIdsInWindow(windowId);
    await tabs.activate(neighbourOf(tabId, visible));
    await moveTab(tabId, groupId);
  }

  async function menuClicked(
    info: { menuItemId: string | number },
    tab: ClickedTab | undefined,
  ): Promise<void> {
    if (info.menuItemId === REFRESH_GROUPS) {
      await menus.removeAll();
      await createMenuList();
      return;
    }

    const groupId = groupIdOfMenuItem(info.menuItemId);
    if (
      groupId === undefined ||
      tab?.id === undefined ||
      tab.windowId === undefined
    ) {
      logger.debug(
        `Ignored a click on the menu item ${String(info.menuItemId)}`,
      );
      return;
    }
    const { id: tabId, windowId } = tab;

    const selected = await tabs.highlightedIdsInWindow(windowId);
    const activeTabId = (await tabs.listInWindow(windowId)).find(
      ({ active }) => active,
    )?.id;

    if (selected.length > 1) {
      // The active tab is among those selected, and stays where it is
      await moveAll(
        selected.filter((id) => id !== activeTabId),
        groupId,
      );
    } else if (activeTabId === tabId) {
      await moveActiveTab(tabId, windowId, groupId);
    } else {
      // Right-clicking a tab does not select it
      await moveTab(tabId, groupId);
    }
  }

  return { moveTab, menuClicked };
}
