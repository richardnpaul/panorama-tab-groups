import {
  NATIVE_GROUP_EDIT_RETRY_MS,
  NATIVE_GROUP_EDIT_TRIES,
} from '../../core/constants.js';
import type {
  NativeGroupColor,
  NativeGroups,
} from '../../ports/native-groups.js';
import { messageOf } from '../../share/guards.js';

// What Chromium says while the user drags a tab: "Tabs cannot be edited right now (user may be
// dragging a tab)."
const WHILE_DRAGGING = /dragging a tab/u;

const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** The part of `browser.tabGroups` and `browser.tabs` the extension uses */
export interface NativeGroupsApi {
  tabGroups: {
    update(
      groupId: number,
      updateProperties: {
        collapsed?: boolean;
        title?: string;
        color?: NativeGroupColor;
      },
    ): Promise<unknown>;
    query(queryInfo: { windowId: number }): Promise<{ id: number }[]>;
    get(groupId: number): Promise<{
      windowId: number;
      title?: string | undefined;
      collapsed?: boolean | undefined;
    }>;
  };
  tabs: {
    query(queryInfo: {
      groupId: number;
    }): Promise<{ id?: number | undefined }[]>;
    get(tabId: number): Promise<{ pinned?: boolean | undefined }>;
    group(options: {
      tabIds: number[];
      groupId?: number;
      createProperties?: { windowId: number };
    }): Promise<number>;
    ungroup(tabIds: number[]): Promise<unknown>;
  };
}

export function createBrowserNativeGroups(
  getApi: () => NativeGroupsApi,
  wait: (ms: number) => Promise<void> = pause,
): NativeGroups {
  // An edit the browser refuses while a tab is dragged is asked for again once the drag is over;
  // any other refusal, or one that lasts, is passed on
  async function editing(edit: () => Promise<unknown>, left: number) {
    try {
      await edit();
    } catch (error) {
      if (left <= 1 || !WHILE_DRAGGING.test(messageOf(error))) {
        throw error;
      }
      await wait(NATIVE_GROUP_EDIT_RETRY_MS);
      await editing(edit, left - 1);
    }
  }

  // `tabs.group` unpins a pinned tab (both browsers), and a pinned tab has no group of the
  // add-on's, so none is passed to it. A tab that is gone makes this reject, as grouping would.
  async function unpinned(tabIds: readonly number[]): Promise<number[]> {
    const tabs = await Promise.all(
      tabIds.map(async (id) => ({
        id,
        pinned: (await getApi().tabs.get(id)).pinned === true,
      })),
    );
    return tabs.filter(({ pinned }) => !pinned).map(({ id }) => id);
  }

  return {
    async setCollapsed(nativeGroupId, collapsed) {
      await getApi().tabGroups.update(nativeGroupId, { collapsed });
    },

    async listIdsInWindow(windowId) {
      const groups = await getApi().tabGroups.query({ windowId });
      return groups.map(({ id }) => id);
    },

    async tabIdsIn(nativeGroupId) {
      const tabs = await getApi().tabs.query({ groupId: nativeGroupId });
      return tabs.flatMap(({ id }) => (id === undefined ? [] : [id]));
    },

    async createFromTabs(tabIds, windowId) {
      const ids = await unpinned(tabIds);
      if (ids.length === 0) {
        throw new Error('Every tab is pinned, so there is nothing to group');
      }
      return getApi().tabs.group({
        tabIds: ids,
        createProperties: { windowId },
      });
    },

    async addTabs(tabIds, nativeGroupId) {
      const ids = await unpinned(tabIds);
      if (ids.length === 0) {
        return;
      }
      await getApi().tabs.group({ tabIds: ids, groupId: nativeGroupId });
    },

    async removeTabs(tabIds) {
      await getApi().tabs.ungroup([...tabIds]);
    },

    async setTitle(nativeGroupId, title) {
      await editing(
        () => getApi().tabGroups.update(nativeGroupId, { title }),
        NATIVE_GROUP_EDIT_TRIES,
      );
    },

    async setAppearance(nativeGroupId, { title, color }) {
      await getApi().tabGroups.update(
        nativeGroupId,
        color === undefined ? { title } : { title, color },
      );
    },

    async get(nativeGroupId) {
      const { windowId, title, collapsed } =
        await getApi().tabGroups.get(nativeGroupId);
      return { windowId, title, collapsed: collapsed === true };
    },
  };
}
