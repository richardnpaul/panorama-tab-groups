import type {
  NativeGroupColor,
  NativeGroups,
} from '../../ports/native-groups.js';

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
    }>;
  };
  tabs: {
    query(queryInfo: {
      groupId: number;
    }): Promise<{ id?: number | undefined }[]>;
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
): NativeGroups {
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

    createFromTabs: (tabIds, windowId) =>
      getApi().tabs.group({
        tabIds: [...tabIds],
        createProperties: { windowId },
      }),

    async addTabs(tabIds, nativeGroupId) {
      await getApi().tabs.group({
        tabIds: [...tabIds],
        groupId: nativeGroupId,
      });
    },

    async removeTabs(tabIds) {
      await getApi().tabs.ungroup([...tabIds]);
    },

    async setAppearance(nativeGroupId, { title, color }) {
      await getApi().tabGroups.update(
        nativeGroupId,
        color === undefined ? { title } : { title, color },
      );
    },

    async get(nativeGroupId) {
      const { windowId, title } = await getApi().tabGroups.get(nativeGroupId);
      return { windowId, title };
    },
  };
}
