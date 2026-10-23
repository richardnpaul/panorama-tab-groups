import { PANORAMA_VIEW_GROUP_ID } from '../core/constants.js';
import { nativeGroupIdOf } from '../core/groups.js';
import {
  fallbackActiveGroup,
  isPanoramaViewTab,
  type OpeningView,
} from '../core/tab-assignment.js';
import type { Clock } from '../ports/clock.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { NativeGroupAssignment } from './native-group-assignment.js';

/** What is known about a tab when the browser says it was created */
export interface CreatedTab {
  id: number;
  windowId: number;
  active?: boolean | undefined;
  url?: string | undefined;
  pendingUrl?: string | undefined;
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
    | 'setGroups'
  >;
  tabs: Pick<Tabs, 'get'>;
  nativeGroups: Pick<NativeGroups, 'addTabs' | 'listIdsInWindow' | 'tabIdsIn'>;
  assignment: NativeGroupAssignment;
  toggleVisibleTabs: (activeGroup: number) => Promise<void>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  // Settles once the extension has finished starting up
  waitForInitialization: () => Promise<void>;
  // Whether a backup is being opened, whose tabs are not to be assigned
  isOpeningBackup: () => boolean;
  // The Panorama view tab that was asked for and has not shown up yet
  openingView: () => OpeningView | null;
  // The view tab shows up: stop waiting for it
  finishOpeningView: () => void;
  clock: Clock;
  // The address of the Panorama view page
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

    let activeGroup = await groupState.getActiveGroup(tab.windowId);
    if (activeGroup === undefined) {
      logger.debug(
        `[TabCreated] activeGroup is undefined for window ${String(tab.windowId)}, using fallback`,
      );
      activeGroup = fallbackActiveGroup(
        await groupState.getGroups(tab.windowId),
      );
      await groupState.setActiveGroup(tab.windowId, activeGroup);
    }

    await groupState.setTabGroup(tab.id, activeGroup);
    logger.debug(
      `[TabCreated] Tab ${String(tab.id)} created in window ${String(tab.windowId)}, assigned to group ${String(activeGroup)}`,
    );
    return activeGroup;
  }

  // Put the new tab in the native group of its group, making one if there is
  // none yet. 'show-group' is for when its group is to be shown even if the tab
  // is not active. A native group that could not safely be made changes
  // nothing about the group the tab is in, so the tab is treated like any other.
  async function assignNewTabToNativeGroup(
    tab: CreatedTab,
    groupId: number,
  ): Promise<'show-group' | 'as-is'> {
    const groups = (await groupState.getGroups(tab.windowId)) ?? [];
    const group = groups.find(({ id }) => id === groupId);
    const activeGroup = await groupState.getActiveGroup(tab.windowId);
    const nativeGroupId = nativeGroupIdOf(group);

    if (group !== undefined && nativeGroupId === undefined) {
      const creation = await assignment.createNativeGroup({
        windowId: tab.windowId,
        group,
        groups,
        label: 'TabCreated',
      });
      // The browser group is new, so the view may have to give way to it
      return creation.kind === 'created' && groupId === activeGroup
        ? 'show-group'
        : 'as-is';
    }

    if (nativeGroupId !== undefined && groupId === activeGroup) {
      await nativeGroups.addTabs([tab.id], nativeGroupId);
      logger.debug(
        `Assigned tab ${String(tab.id)} to native group ${String(nativeGroupId)} (panorama group ${String(groupId)})`,
      );
    } else {
      logger.debug(
        `Skipped native group assignment for tab ${String(tab.id)}: group inactive (will be grouped when activated)`,
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

  const withNativeGroup = (
    groups: readonly Group[],
    groupId: number,
    nativeGroupId: number,
  ): Group[] =>
    groups.map((group) =>
      group.id === groupId ? { ...group, nativeGroupId } : group,
    );

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
      await groupState.setGroups(
        tab.windowId,
        withNativeGroup(groups, activeGroup, existing),
      );
      logger.debug(
        `Linked existing native group ${String(existing)} to panorama group ${String(activeGroup)}`,
      );
      return;
    }

    try {
      await assignment.createNativeGroup({
        windowId: tab.windowId,
        group,
        groups,
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

    if (isPanoramaViewTab({ tab, viewUrl, opening, now })) {
      finishOpeningView();
      await groupState.setTabGroup(tab.id, PANORAMA_VIEW_GROUP_ID);
      logger.debug(
        `Created panorama view tab ${String(tab.id)}, assigned groupId -1`,
      );
      return;
    }

    const groupId = await groupOfNewTab(tab);
    if (groupId === PANORAMA_VIEW_GROUP_ID) {
      return;
    }

    let outcome: Awaited<ReturnType<typeof assignNewTabToNativeGroup>> =
      'as-is';
    if (await useNativeGroups()) {
      try {
        outcome = await assignNewTabToNativeGroup(tab, groupId);
      } catch (error) {
        logger.warn('Could not assign new tab to native group:', error);
      }
    }

    // The view must give way to a new tab that is active, native groups or not
    if (tab.active === true || outcome === 'show-group') {
      await toggleVisibleTabs(groupId);
    }
  }

  async function tabAttached(
    tabId: number,
    { newWindowId }: { newWindowId: number },
  ): Promise<void> {
    await waitForInitialization();

    // The tab joins the group the new window is showing
    const activeGroup = await groupState.getActiveGroup(newWindowId);
    if (activeGroup !== undefined) {
      await groupState.setTabGroup(tabId, activeGroup);
    }

    await tabCreated(await tabs.get(tabId));
  }

  async function tabDetached(tabId: number): Promise<void> {
    await groupState.clearTabGroup(tabId);
  }

  async function tabActivated({ tabId }: { tabId: number }): Promise<void> {
    await waitForInitialization();

    const tab = await tabs.get(tabId);
    if (tab.pinned) {
      return;
    }

    const activeGroup = await groupState.getTabGroup(tabId);
    if (activeGroup === undefined) {
      // tabCreated has not given the tab a group yet, and will update the
      // visibility itself once it has
      logger.warn(
        '[TabActivated] ⚠️ activeGroup is UNDEFINED - race condition detected!',
      );
      return;
    }

    if (activeGroup !== PANORAMA_VIEW_GROUP_ID) {
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

    await toggleVisibleTabs(activeGroup);
  }

  return { tabCreated, tabAttached, tabDetached, tabActivated };
}
