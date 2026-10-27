import { VIEWER_GROUP_ID } from '../core/constants.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { NativeGroupsSync } from './native-groups-sync.js';
import type { ViewOpening } from './view-opening.js';

export interface BrowserEventsDeps {
  groupState: Pick<GroupState, 'getTabGroup' | 'setTabGroup'>;
  nativeGroups: Pick<NativeGroups, 'removeTabs'>;
  nativeGroupsSync: Pick<NativeGroupsSync, 'cleanup'>;
  viewOpening: Pick<ViewOpening, 'tabRemoved'>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  // The address of the view page
  viewUrl: string;
  logger: Pick<Logger, 'debug' | 'error'>;
}

/** What the browser says about a tab that changed */
export interface TabChange {
  url?: string | undefined;
}

export interface UpdatedTab {
  url?: string | undefined;
  pendingUrl?: string | undefined;
}

/** What the browser says about a setting that changed */
export interface StorageChange {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface BrowserEvents {
  /** A tab went to the view page: it is the view, whatever group it was in */
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
  useNativeGroups,
  viewUrl,
  logger,
}: BrowserEventsDeps): BrowserEvents {
  return {
    async onTabUpdated(tabId, changeInfo, tab) {
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

      logger.debug('[Storage] Native groups disabled, starting cleanup...');
      try {
        await nativeGroupsSync.cleanup();
      } catch (error) {
        logger.error('[Storage] Cleanup failed:', error);
      }
    },
  };
}
