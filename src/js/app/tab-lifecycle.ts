import {
  isReservedGroupId,
  UNGROUPED_GROUP_ID,
  VIEWER_GROUP_ID,
} from '../core/constants.js';
import { nativeGroupIdOf } from '../core/groups.js';
import {
  fallbackActiveGroup,
  isViewerTab,
  type OpeningView,
} from '../core/tab-assignment.js';
import type { Clock } from '../ports/clock.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { NativeGroupAssignment } from './native-group-assignment.js';

/** What is known about a tab when the browser says it was created */
export interface CreatedTab {
  id: number;
  windowId: number;
  active?: boolean | undefined;
  // A pinned tab is in no group
  pinned?: boolean | undefined;
  // Whether the browser has the tab hidden, as a window that is restored brings its tabs back
  hidden?: boolean | undefined;
  url?: string | undefined;
  pendingUrl?: string | undefined;
  // The browser's own tab group of the tab; -1 or nothing means it is in none
  browserGroupId?: number | undefined;
}

export interface TabLifecycleDeps {
  groupState: Pick<
    GroupState,
    | 'getTabGroup'
    | 'setTabGroup'
    | 'clearTabGroup'
    | 'getActiveGroup'
    | 'setActiveGroup'
    | 'getGroups'
    | 'setNativeGroupLink'
  >;
  tabs: Pick<Tabs, 'get' | 'show'>;
  nativeGroups: Pick<
    NativeGroups,
    'addTabs' | 'removeTabs' | 'listIdsInWindow' | 'tabIdsIn'
  >;
  assignment: NativeGroupAssignment;
  // Shows the tabs of the group in the window, and hides the rest
  toggleVisibleTabs: (activeGroup: number, windowId: number) => Promise<void>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  // Settles once the extension has finished starting up
  waitForInitialization: () => Promise<void>;
  // Whether a backup is being opened, whose tabs are not to be assigned
  isOpeningBackup: () => boolean;
  // The viewer tab that was asked for and has not shown up yet
  openingView: () => OpeningView | null;
  // The view tab shows up: stop waiting for it
  finishOpeningView: () => void;
  clock: Clock;
  // The address of the view page
  viewUrl: string;
  logger: Pick<Logger, 'debug' | 'warn' | 'error'>;
}

export interface TabLifecycle {
  tabCreated: (tab: CreatedTab) => Promise<void>;
  tabAttached: (
    tabId: number,
    attachInfo: { newWindowId: number },
  ) => Promise<void>;
  tabDetached: (tabId: number) => Promise<void>;
  tabActivated: (activeInfo: { tabId: number }) => Promise<void>;
}

export function createTabLifecycle({
  groupState,
  tabs,
  nativeGroups,
  assignment,
  toggleVisibleTabs,
  useNativeGroups,
  waitForInitialization,
  isOpeningBackup,
  openingView,
  finishOpeningView,
  clock,
  viewUrl,
  logger,
}: TabLifecycleDeps): TabLifecycle {
  // The group that goes with the native group the tab is in, if one does
  async function groupOfNativeGroup(
    tab: CreatedTab,
  ): Promise<number | undefined> {
    if (
      tab.browserGroupId === undefined ||
      tab.browserGroupId <= 0 ||
      !(await useNativeGroups())
    ) {
      return undefined;
    }
    return (await groupState.getGroups(tab.windowId))?.find(
      ({ nativeGroupId }) => nativeGroupId === tab.browserGroupId,
    )?.id;
  }

  // The group of a new tab: the one it came with, or else the window's active
  // group, which a window that has only just been created may not have yet
  async function groupOfNewTab(tab: CreatedTab): Promise<number> {
    const existing = await groupState.getTabGroup(tab.id);
    if (existing !== undefined) {
      logger.debug(
        `[TabCreated] Tab ${String(tab.id)} created in window ${String(tab.windowId)}, already has group ${String(existing)}`,
      );
      return existing;
    }

    // A tab that arrives in a native group the add-on has a group for (a tab that was closed and is
    // reopened is put back in its group by the browser) is in that group
    const linked = await groupOfNativeGroup(tab);
    if (linked !== undefined) {
      await groupState.setTabGroup(tab.id, linked);
      logger.debug(
        `[TabCreated] Tab ${String(tab.id)} created in window ${String(tab.windowId)}, in the native group of group ${String(linked)}`,
      );
      return linked;
    }

    let activeGroup = await groupState.getActiveGroup(tab.windowId);
    const groups = await groupState.getGroups(tab.windowId);
    if (activeGroup === undefined) {
      logger.debug(
        `[TabCreated] activeGroup is undefined for window ${String(tab.windowId)}, using fallback`,
      );
      activeGroup = fallbackActiveGroup(groups);
      await groupState.setActiveGroup(tab.windowId, activeGroup);
    } else if (groups?.some(({ id }) => id === activeGroup) === false) {
      // A group deleted while the window could not be given the next (see delete-group.ts)
      logger.debug(
        `[TabCreated] Group ${String(activeGroup)} is not one of window ${String(tab.windowId)}, using fallback`,
      );
      activeGroup = fallbackActiveGroup(groups);
      await groupState.setActiveGroup(tab.windowId, activeGroup);
    }

    await groupState.setTabGroup(tab.id, activeGroup);
    logger.debug(
      `[TabCreated] Tab ${String(tab.id)} created in window ${String(tab.windowId)}, assigned to group ${String(activeGroup)}`,
    );
    return activeGroup;
  }

  // Put the new tab in the native group of its group, making one if there is
  // none yet, collapsed when the group is not the one shown. 'show-group' is for
  // when its group is to be shown even if the tab is not active. A native group
  // that could not safely be made changes nothing about the group the tab is in,
  // so the tab is treated like any other. The group for ungrouped tabs has none.
  async function assignNewTabToNativeGroup(
    tab: CreatedTab,
    groupId: number,
  ): Promise<'show-group' | 'as-is'> {
    if (isReservedGroupId(groupId)) {
      return 'as-is';
    }
    const groups = (await groupState.getGroups(tab.windowId)) ?? [];
    const group = groups.find(({ id }) => id === groupId);
    const activeGroup = await groupState.getActiveGroup(tab.windowId);
    const nativeGroupId = nativeGroupIdOf(group);

    if (group !== undefined && nativeGroupId === undefined) {
      const creation = await assignment.createNativeGroup({
        windowId: tab.windowId,
        group,
        label: 'TabCreated',
        collapsed: groupId !== activeGroup,
      });
      // The browser group is new, so the view may have to give way to it
      return creation.kind === 'created' && groupId === activeGroup
        ? 'show-group'
        : 'as-is';
    }

    if (nativeGroupId !== undefined) {
      await nativeGroups.addTabs([tab.id], nativeGroupId);
      logger.debug(
        `Assigned tab ${String(tab.id)} to native group ${String(nativeGroupId)} (group ${String(groupId)})`,
      );
    }
    return 'as-is';
  }

  // The native group the tab is in, if it is in one that no group has
  // claimed: a tab opened from a grouped tab joins that group by itself
  async function unclaimedNativeGroupOfTab(
    tabId: number,
    windowId: number,
    claimed: readonly number[],
  ): Promise<number | undefined> {
    const nativeGroupIds = await nativeGroups.listIdsInWindow(windowId);
    const members = await Promise.all(
      nativeGroupIds.map(async (nativeGroupId) => ({
        nativeGroupId,
        tabIds: await nativeGroups.tabIdsIn(nativeGroupId),
      })),
    );
    return members.find(
      ({ nativeGroupId, tabIds }) =>
        !claimed.includes(nativeGroupId) && tabIds.includes(tabId),
    )?.nativeGroupId;
  }

  // With native groups off, a tab that arrives in one (a window the user
  // restores comes back with the groups it was closed with) is taken out: its
  // group is the add-on's own, which the tab keeps
  async function leaveNativeGroup(tab: CreatedTab): Promise<void> {
    if (tab.browserGroupId === undefined || tab.browserGroupId <= 0) {
      return;
    }
    try {
      await nativeGroups.removeTabs([tab.id]);
    } catch (error) {
      logger.warn(
        `Could not take tab ${String(tab.id)} out of its native group:`,
        error,
      );
    }
  }

  // Give the group of the activated tab a native group: the one its tab is
  // already in, or a new one. Whether that worked does not matter to showing
  // the group.
  async function ensureNativeGroup(
    tab: { id: number; windowId: number },
    activeGroup: number,
  ): Promise<void> {
    const groups = (await groupState.getGroups(tab.windowId)) ?? [];
    const group = groups.find(({ id }) => id === activeGroup);
    if (group === undefined || nativeGroupIdOf(group) !== undefined) {
      return;
    }

    const existing = await unclaimedNativeGroupOfTab(
      tab.id,
      tab.windowId,
      groups.flatMap((other) => nativeGroupIdOf(other) ?? []),
    );
    if (existing !== undefined) {
      await groupState.setNativeGroupLink(tab.windowId, activeGroup, existing);
      logger.debug(
        `Linked existing native group ${String(existing)} to group ${String(activeGroup)}`,
      );
      return;
    }

    try {
      await assignment.createNativeGroup({
        windowId: tab.windowId,
        group,
        label: 'TabActivated',
      });
    } catch (error) {
      logger.warn(
        `[TabActivated] Could not create native tab group in window ${String(tab.windowId)}:`,
        error,
      );
    }
  }

  async function tabCreated(tab: CreatedTab): Promise<void> {
    if (isOpeningBackup()) {
      return;
    }

    // Judged by what was known when the tab appeared, not after the wait
    const opening = openingView();
    const now = clock.now();
    await waitForInitialization();

    if (isViewerTab({ tab, viewUrl, opening, now })) {
      finishOpeningView();
      await groupState.setTabGroup(tab.id, VIEWER_GROUP_ID);
      logger.debug(`Created viewer tab ${String(tab.id)}, assigned groupId -1`);
      return;
    }

    // A pinned tab is in no group, whatever it came back with
    if (tab.pinned === true) {
      await groupState.clearTabGroup(tab.id);
      logger.debug(
        `[TabCreated] Tab ${String(tab.id)} is pinned: it has no group`,
      );
      return;
    }

    const groupId = await groupOfNewTab(tab);
    if (groupId === VIEWER_GROUP_ID) {
      return;
    }

    let outcome: Awaited<ReturnType<typeof assignNewTabToNativeGroup>> =
      'as-is';
    if (await useNativeGroups()) {
      // Native mode hides no tab: one that comes back hidden (a window closed while tabs were
      // hidden, restored now) is shown, in its native group
      if (tab.hidden === true) {
        await tabs.show([tab.id]);
      }
      try {
        outcome = await assignNewTabToNativeGroup(tab, groupId);
      } catch (error) {
        logger.warn('Could not assign new tab to native group:', error);
      }
    } else {
      await leaveNativeGroup(tab);
    }

    // The view must give way to a new tab that is active, native groups or not. A tab in the group
    // for ungrouped tabs (one that comes back in it) shows no group.
    if (
      !isReservedGroupId(groupId) &&
      (tab.active === true || outcome === 'show-group')
    ) {
      await toggleVisibleTabs(groupId, tab.windowId);
    }
  }

  async function tabAttached(
    tabId: number,
    { newWindowId }: { newWindowId: number },
  ): Promise<void> {
    await waitForInitialization();

    const tab = await tabs.get(tabId);
    // The tab joins the group the new window is showing, unless it is pinned
    const activeGroup = await groupState.getActiveGroup(newWindowId);
    if (activeGroup !== undefined && !tab.pinned) {
      await groupState.setTabGroup(tabId, activeGroup);
    }

    await tabCreated(tab);

    // The tab may have been hidden in the window it left: in the group shown here, it is shown
    const shown = await groupState.getActiveGroup(newWindowId);
    if (
      shown !== undefined &&
      (await groupState.getTabGroup(tabId)) === shown
    ) {
      await toggleVisibleTabs(shown, newWindowId);
    }
  }

  async function tabDetached(tabId: number): Promise<void> {
    await groupState.clearTabGroup(tabId);
  }

  async function tabActivated({ tabId }: { tabId: number }): Promise<void> {
    await waitForInitialization();

    // The tab may be closed already: closing the one in front brings the next to the front, and
    // that one may be on its way out too, as when a group is deleted
    const tab = await tabs.get(tabId).catch(() => undefined);
    if (tab === undefined) {
      logger.debug(
        `[TabActivated] Tab ${String(tabId)} was closed before it could be looked at`,
      );
      return;
    }
    if (tab.pinned) {
      return;
    }

    const activeGroup = await groupState.getTabGroup(tabId);
    if (activeGroup === undefined) {
      // The browser can say a new tab was activated before it has a group.
      // That is expected: tabCreated gives it one and shows it, so this is
      // only noted
      logger.debug(
        `[TabActivated] Tab ${String(tabId)} has no group yet; tabCreated will show its group`,
      );
      return;
    }

    // A tab in the group for ungrouped tabs shows nothing of a group, and hides nothing
    if (activeGroup === UNGROUPED_GROUP_ID) {
      return;
    }

    if (activeGroup !== VIEWER_GROUP_ID) {
      try {
        await groupState.setActiveGroup(tab.windowId, activeGroup);
      } catch (error) {
        // Carry on: showing the right tabs matters more than remembering this
        logger.error(
          `[TabActivated] ERROR in setActiveGroup(${String(tab.windowId)}, ${String(activeGroup)}):`,
          error,
        );
      }

      if (await useNativeGroups()) {
        await ensureNativeGroup(tab, activeGroup);
      }
    }

    await toggleVisibleTabs(activeGroup, tab.windowId);
  }

  return { tabCreated, tabAttached, tabDetached, tabActivated };
}
