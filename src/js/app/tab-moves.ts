import { isReservedGroupId } from '../core/constants.js';
import { nativeGroupIdOf } from '../core/groups.js';
import { groupOfMenuItem, neighbourOf } from '../core/menu-items.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { NativeGroupAssignment } from './native-group-assignment.js';
import type { OwnMoves } from './own-moves.js';

const REFRESH_GROUPS = 'refresh-groups';

export interface TabMovesDeps {
  tabs: Pick<
    Tabs,
    | 'moveToEnd'
    | 'moveBeside'
    | 'unpin'
    | 'get'
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
  // Make the menu items for the groups of the window again
  createMenuList: () => Promise<void>;
  toggleVisibleTabs: (
    activeGroup: number | undefined,
    windowId: number,
  ) => Promise<void>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  // What the browser says of a tab that the add-on moves is not the person's doing
  ownMoves: Pick<OwnMoves, 'during'>;
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
  /**
   * A tab the view dropped: it is sent to the group, as `moveTab` sends it, and then put next to
   * the tab it was dropped by, if it was, where it stays in the native group of its group. The
   * view asks the background to do it, as what the browser says of the moves is not the person's
   * doing only where they are made.
   */
  placeTab: (
    tabId: number,
    groupId: number,
    windowId: number,
    beside?: { tabId: number; before: boolean },
  ) => Promise<void>;
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
  createMenuList,
  toggleVisibleTabs,
  useNativeGroups,
  ownMoves,
  logger,
}: TabMovesDeps): TabMoves {
  // Every group that has a tab has its native group, collapsed when it is not
  // the one shown: the tab joins it, and it is made if there is none yet. The
  // group for ungrouped tabs has none, and where none could be made the tab
  // leaves the one it was in, or it would be in a group of another.
  async function moveToNativeGroup(
    tabId: number,
    groupId: number,
    windowId: number,
    activeGroup: number | undefined,
  ): Promise<void> {
    const groups = (await groupState.getGroups(windowId)) ?? [];
    const group = isReservedGroupId(groupId)
      ? undefined
      : groups.find(({ id }) => id === groupId);
    const nativeGroupId = nativeGroupIdOf(group);
    if (nativeGroupId !== undefined) {
      await nativeGroups.addTabs([tabId], nativeGroupId);
      return;
    }
    if (
      group !== undefined &&
      (
        await assignment.createNativeGroup({
          windowId,
          group,
          label: 'TabMoved',
          collapsed: groupId !== activeGroup,
        })
      ).kind === 'created'
    ) {
      return;
    }
    await nativeGroups.removeTabs([tabId]);
  }

  // The tab was the last the window showed, so with it gone from the group
  // there would be nothing to show: the window follows the tab to its group. A pinned tab
  // showed nothing of a group, and is the last when no other tab does.
  async function wasLastShown(
    tabId: number,
    windowId: number,
    activeGroup: number | undefined,
  ): Promise<boolean> {
    if (activeGroup === undefined) {
      return false;
    }
    if (
      (await groupState.getTabGroup(tabId)) !== activeGroup &&
      !(await tabs.get(tabId)).pinned
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
    // As the browser's own menu does, a pinned tab is unpinned and then moved. Its group is
    // stored first, so that the unpinning is not taken for a tab left without a group.
    if ((await tabs.get(tabId)).pinned) {
      await tabs.unpin(tabId);
    }
    if (switched) {
      await groupState.setActiveGroup(windowId, groupId);
    }
    const activeGroup = switched ? groupId : shown;

    await ownMoves.during([tabId], async () => {
      // Before it is put in a native group: Chromium takes a tab out of its group when it is moved past the group
      await tabs.moveToEnd(tabId);

      if (await useNativeGroups()) {
        try {
          await moveToNativeGroup(tabId, groupId, windowId, activeGroup);
        } catch (error) {
          // The tab may be gone, or the browser may have no native groups
          logger.warn('Could not assign tab to native group:', error);
        }
      }
    });

    await toggleVisibleTabs(activeGroup, windowId);
  }

  // Chromium takes a tab out of its native group when it is moved past the edge of the group
  async function keepInNativeGroup(
    tabId: number,
    groupId: number,
    windowId: number,
  ): Promise<void> {
    const nativeGroupId = nativeGroupIdOf(
      (await groupState.getGroups(windowId))?.find(({ id }) => id === groupId),
    );
    if (
      nativeGroupId !== undefined &&
      (await tabs.get(tabId)).browserGroupId !== nativeGroupId
    ) {
      await nativeGroups.addTabs([tabId], nativeGroupId);
    }
  }

  async function placeTab(
    tabId: number,
    groupId: number,
    windowId: number,
    beside?: { tabId: number; before: boolean },
  ): Promise<void> {
    if (
      beside === undefined ||
      (await groupState.getTabGroup(tabId)) !== groupId
    ) {
      await moveTab(tabId, groupId, windowId);
    }
    if (beside === undefined) {
      return;
    }
    await ownMoves.during([tabId], async () => {
      await tabs.moveBeside(tabId, beside.tabId, beside.before);
      if (await useNativeGroups()) {
        try {
          await keepInNativeGroup(tabId, groupId, windowId);
        } catch (error) {
          logger.warn('Could not assign tab to native group:', error);
        }
      }
    });
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
    // A pinned tab is in no group: the tabs of the group the window shows take over from it
    const own = (await tabs.get(tabId)).pinned
      ? await groupState.getActiveGroup(windowId)
      : await groupState.getTabGroup(tabId);
    const visible = await tabs.visibleIdsInWindow(windowId);
    const beside = await Promise.all(
      visible.map(async (id) => ({
        id,
        sameGroup: id === tabId || (await groupState.getTabGroup(id)) === own,
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
      await createMenuList();
      return;
    }

    const target = groupOfMenuItem(info.menuItemId);
    if (
      target === undefined ||
      tab?.id === undefined ||
      tab.windowId !== target.windowId
    ) {
      logger.debug(
        `Ignored a click on the menu item ${String(info.menuItemId)}`,
      );
      return;
    }
    const { id: tabId, windowId } = tab;
    const { groupId } = target;

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

  return { moveTab, placeTab, menuClicked };
}
