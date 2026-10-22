import { PANORAMA_VIEW_GROUP_ID } from '../core/constants.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { NativeGroups } from '../ports/native-groups.js';
import type { Tabs } from '../ports/tabs.js';
import type { NativeGroupsSync } from './native-groups-sync.js';
import type { ViewOpening } from './view-opening.js';

export interface BrowserEventsDeps {
  groupState: Pick<GroupState, 'getTabGroup' | 'setTabGroup'>;
  nativeGroups: Pick<NativeGroups, 'removeTabs'>;
  tabs: Pick<Tabs, 'open'>;
  nativeGroupsSync: Pick<NativeGroupsSync, 'cleanup'>;
  viewOpening: Pick<ViewOpening, 'tabRemoved'>;
  // Whether native tab groups are available and switched on
  useNativeGroups: () => Promise<boolean>;
  // The address of the Panorama view page
  viewUrl: string;
  // The version of the extension
  version: string;
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

export interface InstalledDetails {
  reason: string;
  temporary?: boolean | undefined;
}

export interface BrowserEvents {
  /** A tab went to the Panorama view page: it is the view, whatever group it was in */
  onTabUpdated: (
    tabId: number,
    changeInfo: TabChange,
    tab: UpdatedTab,
  ) => Promise<void>;
  /** A tab was closed */
  onTabRemoved: (tabId: number) => void;
  /** The extension was installed or updated: show what is new */
  onInstalled: (details: InstalledDetails) => Promise<void>;
  /** A setting changed: when native tab groups were switched off, clean up */
  onStorageChanged: (
    changes: Record<string, StorageChange>,
    areaName: string,
  ) => Promise<void>;
}

export function createBrowserEvents({
  groupState,
  nativeGroups,
  tabs,
  nativeGroupsSync,
  viewOpening,
  useNativeGroups,
  viewUrl,
  version,
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
        (await groupState.getTabGroup(tabId)) === PANORAMA_VIEW_GROUP_ID
      ) {
        return;
      }

      await groupState.setTabGroup(tabId, PANORAMA_VIEW_GROUP_ID);
      if (await useNativeGroups()) {
        // The view is never in a native group, and may not be in one now
        await nativeGroups.removeTabs([tabId]).catch(() => undefined);
      }
      logger.debug(
        `Tab ${String(tabId)} updated to panorama view, assigned groupId -1`,
      );
    },

    onTabRemoved(tabId) {
      viewOpening.tabRemoved(tabId);
    },

    async onInstalled({ reason, temporary }) {
      // A temporary add-on is one being developed
      if (temporary !== true && reason === 'update') {
        await tabs.open(
          `https://github.com/projectdelphai/panorama-tab-groups/releases/tag/${version}`,
          true,
        );
      }
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
