import { nativeGroupIdOf } from '../core/groups.js';
import { groupIdOfMenuItem, neighbourOf } from '../core/menu-items.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Menus } from '../ports/menus.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { NativeGroupAssignment } from './native-group-assignment.js';

const REFRESH_GROUPS = 'refresh-groups';

export interface TabMovesDeps {
  tabs: Pick<
    Tabs,
    | 'moveToEnd'
    | 'activate'
    | 'highlightedIdsInWindow'
    | 'visibleIdsInWindow'
    | 'listInWindow'
    | 'listSummariesInWindow'
  >;
  windows: Pick<Windows, 'currentWindowId'>;
  groupState: Pick<
    GroupState,
    | 'setTabGroup'
    | 'getTabGroup'
    | 'getGroups'
    | 'getActiveGroup'
    | 'setActiveGroup'
  >;
  nativeGroups: Pick<NativeGroups, 'addTabs' | 'removeTabs'>;
  assignment: Pick<NativeGroupAssignment, 'createNativeGroup'>;
  menus: Pick<Menus, 'removeAll'>;
  // Make the menu items for the groups of the window again
  createMenuList: () => Promise<void>;
  toggleVisibleTabs: (
    activeGroup: number | undefined,
    windowId: number,
  ) => Promise<void>;
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
  /** Send a tab to a group; `windowId` is the window of the tab, where it is not the window the code is running in */
  moveTab: (tabId: number, groupId: number, windowId?: number) => Promise<void>;
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
  assignment,
  menus,
  createMenuList,
  toggleVisibleTabs,
  useNativeGroups,
  logger,
}: TabMovesDeps): TabMoves {
  // Only the active group has its tabs in a native group: the others have
  // theirs hidden, which would clash. A group that has none takes its tab out
  // of the one it was in, or the tab would be in a group of another; except
  // when the window has just switched to it, and then it is given one.
  async function moveToNativeGroup(
    tabId: number,
    groupId: number,
    windowId: number,
    activeGroup: number | undefined,
    switched: boolean,
  ): Promise<void> {
    const groups = (await groupState.getGroups(windowId)) ?? [];
    const group = groups.find(({ id }) => id === groupId);
    const nativeGroupId = nativeGroupIdOf(group);
    if (nativeGroupId !== undefined && groupId === activeGroup) {
      await nativeGroups.addTabs([tabId], nativeGroupId);
      return;
    }
    if (
      switched &&
      group !== undefined &&
      (
        await assignment.createNativeGroup({
          windowId,
          group,
          groups,
          label: 'TabMoved',
        })
      ).kind === 'created'
    ) {
      return;
    }
    await nativeGroups.removeTabs([tabId]);
  }

  // The tab was the last the window showed, so with it gone from the group
  // there would be nothing to show: the window follows the tab to its group
  async function wasLastShown(
    tabId: number,
    windowId: number,
    activeGroup: number | undefined,
  ): Promise<boolean> {
    if (
      activeGroup === undefined ||
      (await groupState.getTabGroup(tabId)) !== activeGroup
    ) {
      return false;
    }
    const others = (await tabs.listSummariesInWindow(windowId)).filter(
      ({ id, pinned }) => id !== tabId && !pinned,
    );
    const groups = await Promise.all(
      others.map(({ id }) => groupState.getTabGroup(id)),
    );
    return !groups.includes(activeGroup);
  }

  async function moveTab(
    tabId: number,
    groupId: number,
    inWindow?: number,
  ): Promise<void> {
    const windowId = inWindow ?? (await windows.currentWindowId());
    const shown = await groupState.getActiveGroup(windowId);
    const switched =
      groupId !== shown && (await wasLastShown(tabId, windowId, shown));
    await groupState.setTabGroup(tabId, groupId);
    if (switched) {
      await groupState.setActiveGroup(windowId, groupId);
    }
    const activeGroup = switched ? groupId : shown;

    // Before it is put in a native group: Chromium takes a tab out of its group when it is moved past the group
    await tabs.moveToEnd(tabId);

    if (await useNativeGroups()) {
      try {
        await moveToNativeGroup(
          tabId,
          groupId,
          windowId,
          activeGroup,
          switched,
        );
      } catch (error) {
        // The tab may be gone, or the browser may have no native groups
        logger.warn('Could not assign tab to native group:', error);
      }
    }

    await toggleVisibleTabs(activeGroup, windowId);
  }

  // One after the other, so the tabs end up in the order they were in
  const moveAll = (
    tabIds: readonly number[],
    groupId: number,
    windowId: number,
  ): Promise<void> =>
    tabIds.reduce(
      (done, tabId) => done.then(() => moveTab(tabId, groupId, windowId)),
      Promise.resolve(),
    );

  // The tab that was clicked is the one that is shown, so when it is sent away
  // a neighbour in its own group takes over, rather than the window jumping to
  // another group (a browser that cannot hide tabs has those among the visible)
  async function moveActiveTab(
    tabId: number,
    windowId: number,
    groupId: number,
  ): Promise<void> {
    const own = await groupState.getTabGroup(tabId);
    const visible = await tabs.visibleIdsInWindow(windowId);
    const beside = await Promise.all(
      visible.map(async (id) => ({
        id,
        sameGroup: (await groupState.getTabGroup(id)) === own,
      })),
    );
    await tabs.activate(
      neighbourOf(
        tabId,
        beside.filter(({ sameGroup }) => sameGroup).map(({ id }) => id),
      ),
    );
    await moveTab(tabId, groupId, windowId);
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
        windowId,
      );
    } else if (activeTabId === tabId) {
      await moveActiveTab(tabId, windowId, groupId);
    } else {
      // Right-clicking a tab does not select it
      await moveTab(tabId, groupId, windowId);
    }
  }

  return { moveTab, menuClicked };
}
