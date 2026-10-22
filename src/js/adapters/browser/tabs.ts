import type { Tabs } from '../../ports/tabs.js';

export interface TabsQueryApi {
  tabs: {
    query(queryInfo: {
      currentWindow: boolean;
    }): Promise<{ id?: number | undefined }[]>;
  };
}

export function createBrowserTabs(getApi: () => TabsQueryApi): Tabs {
  return {
    async listIdsInCurrentWindow() {
      const tabs = await getApi().tabs.query({ currentWindow: true });
      return tabs.flatMap(({ id }) => (id === undefined ? [] : [id]));
    },
  };
}
