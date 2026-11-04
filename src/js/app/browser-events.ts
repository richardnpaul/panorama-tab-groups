import { UNGROUPED_GROUP_ID, VIEWER_GROUP_ID } from '../core/constants.js';
import { fallbackActiveGroup } from '../core/tab-assignment.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { NativeGroupsSync } from './native-groups-sync.js';
import type { OwnMoves } from './own-moves.js';
import type { ViewOpening } from './view-opening.js';

export interface BrowserEventsDeps {
  groupState: Pick<
    GroupState,
    | 'getTabGroup'
    | 'setTabGroup'
    | 'clearTabGroup'
    | 'getGroups'
    | 'getActiveGroup'
  >;
  nativeGroups: Pick<NativeGroups, 'removeTabs'>;
  tabs: Pick<Tabs, 'get'>;
  nativeGroupsSync: Pick<NativeGroupsSync, 'cleanup'>;
  viewOpening: Pick<ViewOpening, 'tabRemoved'>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  // Settles once the extension has finished starting up
  waitForInitialization: () => Promise<void>;
  // The tabs the add-on is moving between native groups itself
  ownMoves: Pick<OwnMoves, 'includes'>;
  // The address of the view page
  viewUrl: string;
  logger: Pick<Logger, 'debug' | 'error'>;
}

/** What the browser says about a tab that changed */
export interface TabChange {
  url?: string | undefined;
  // The tab's new pinned state, when that is what changed
  pinned?: boolean | undefined;
  // The tab's new native group (-1 for none), when that is what changed
  groupId?: number | undefined;
}

export interface UpdatedTab {
  url?: string | undefined;
  pendingUrl?: string | undefined;
  windowId?: number | undefined;
  pinned?: boolean | undefined;
}

/** What the browser says about a setting that changed */
export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface BrowserEvents {
  /**
   * A tab went to the view page: it is the view, whatever group it was in. A tab that was
   * pinned has no group; one that was unpinned has none yet, and gets the one it should.
   */
  onTabUpdated: (
    tabId: number,
    changeInfo: TabChange,
    tab: UpdatedTab,
  ) => Promise<void>;
  /** A tab was closed */
  onTabRemoved: (tabId: number) => void;
  /** A setting changed: when native tab groups were switched off, clean up */
  onStorageChanged: (
    changes: Record<string, StorageChange>,
    areaName: string,
  ) => Promise<void>;
}

export function createBrowserEvents({
  groupState,
  nativeGroups,
  nativeGroupsSync,
  viewOpening,
  tabs,
  useNativeGroups,
  waitForInitialization,
  ownMoves,
  viewUrl,
  logger,
}: BrowserEventsDeps): BrowserEvents {
  // A pinned tab is in no group; the browser has taken it out of its native group itself
  async function pinned(tabId: number): Promise<void> {
    if ((await groupState.getTabGroup(tabId)) === VIEWER_GROUP_ID) {
      return;
    }
    await groupState.clearTabGroup(tabId);
    logger.debug(`Tab ${String(tabId)} pinned, so it has no group`);
  }

  // An unpinned tab that has a group already (the menu gave it one) keeps it. Otherwise it is
  // left ungrouped in native mode, where nothing is hidden and the person can move it; with tabs
  // hidden it joins the group the window shows, or it would be hidden where it is not looked for.
  async function unpinned(tabId: number, windowId: number | undefined) {
    if ((await groupState.getTabGroup(tabId)) !== undefined) {
      return;
    }
    if (await useNativeGroups()) {
      await groupState.setTabGroup(tabId, UNGROUPED_GROUP_ID);
      return;
    }
    if (windowId === undefined) {
      return;
    }
    const active = await groupState.getActiveGroup(windowId);
    // The view is not a group a tab can join
    const shown =
      active === undefined || active === VIEWER_GROUP_ID
        ? fallbackActiveGroup(await groupState.getGroups(windowId))
        : active;
    await groupState.setTabGroup(tabId, shown);
    logger.debug(
      `Tab ${String(tabId)} unpinned, so it joins group ${String(shown)}`,
    );
  }

  // A tab the person moved between native groups in the tab strip is in the group that goes with
  // its new native group, or in the group for ungrouped tabs when it left its group. A native
  // group that no group is linked to is left alone: it may be one the add-on is making, whose link
  // is written just after, or one the person made.
  async function follow(
    tabId: number,
    windowId: number,
    nativeGroupId: number,
  ): Promise<void> {
    const own = await groupState.getTabGroup(tabId);
    if (own === VIEWER_GROUP_ID) {
      return;
    }
    if (nativeGroupId > 0) {
      const linked = (await groupState.getGroups(windowId))?.find(
        (group) => group.nativeGroupId === nativeGroupId,
      );
      if (linked !== undefined && linked.id !== own) {
        await groupState.setTabGroup(tabId, linked.id);
        logger.debug(
          `Tab ${String(tabId)} joined native group ${String(nativeGroupId)}, so group ${String(linked.id)}`,
        );
      }
      return;
    }
    if (own !== undefined && own !== UNGROUPED_GROUP_ID) {
      await groupState.setTabGroup(tabId, UNGROUPED_GROUP_ID);
      logger.debug(
        `Tab ${String(tabId)} left its native group, so it has no group`,
      );
    }
  }

  // The group the tab is in now is what counts, not the one the report says: it comes after the
  // fact, and the add-on may have moved the tab again since.
  async function followNativeGroupOf(
    tabId: number,
    tab: UpdatedTab,
  ): Promise<void> {
    if (
      ownMoves.includes(tabId) ||
      tab.pinned === true ||
      tab.windowId === undefined ||
      !(await useNativeGroups())
    ) {
      return;
    }
    // A tab that is closed on the way (a group is deleted with its tabs) has no group to follow,
    // which is what the browser's refusal says; it is noted, and the tab is left alone
    const now = await tabs.get(tabId).catch((error: unknown) => {
      logger.debug(
        `Tab ${String(tabId)} could not be looked at, so its group is left as it is:`,
        error,
      );
      return undefined;
    });
    if (now !== undefined) {
      await follow(tabId, tab.windowId, now.browserGroupId ?? -1);
    }
  }

  return {
    async onTabUpdated(tabId, changeInfo, tab) {
      if (changeInfo.groupId !== undefined) {
        await waitForInitialization();
        await followNativeGroupOf(tabId, tab);
        return;
      }
      if (changeInfo.pinned !== undefined) {
        await waitForInitialization();
        await (changeInfo.pinned
          ? pinned(tabId)
          : unpinned(tabId, tab.windowId));
        return;
      }
      const isView =
        changeInfo.url === viewUrl ||
        tab.url === viewUrl ||
        tab.pendingUrl === viewUrl;
      if (
        !isView ||
        (await groupState.getTabGroup(tabId)) === VIEWER_GROUP_ID
      ) {
        return;
      }

      await groupState.setTabGroup(tabId, VIEWER_GROUP_ID);
      if (await useNativeGroups()) {
        // The view is never in a native group, and may not be in one now
        await nativeGroups.removeTabs([tabId]).catch(() => undefined);
      }
      logger.debug(`Tab ${String(tabId)} updated to view, assigned groupId -1`);
    },

    onTabRemoved(tabId) {
      viewOpening.tabRemoved(tabId);
    },

    async onStorageChanged(changes, areaName) {
      const change = changes.useNativeGroups;
      if (
        areaName !== 'sync' ||
        change?.oldValue !== true ||
        change.newValue !== false
      ) {
        return;
      }

      // Where native groups are the only kind (Chromium), a setting changed on another device, one
      // running a version that let them be switched off, takes nothing apart here
      if (await useNativeGroups()) {
        return;
      }

      logger.debug('[Storage] Native groups disabled, starting cleanup...');
      try {
        await nativeGroupsSync.cleanup();
      } catch (error) {
        logger.error('[Storage] Cleanup failed:', error);
      }
    },
  };
}
