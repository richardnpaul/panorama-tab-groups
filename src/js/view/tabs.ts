type Tab = browser.tabs.Tab;

// The narrow slice of the browser API this module uses. Reading the global at
// call time keeps it replaceable per test.
interface TabsApi {
  sessions: {
    setTabValue(tabId: number, key: string, value: unknown): Promise<void>;
    getTabValue(tabId: number, key: string): Promise<unknown>;
  };
  tabs: {
    query(queryInfo: { currentWindow: boolean }): Promise<Tab[]>;
  };
}

const api = (): TabsApi => browser;

export async function setGroupId(
  tabId: number,
  groupId: number | string,
): Promise<void> {
  await api().sessions.setTabValue(
    tabId,
    'groupId',
    parseInt(String(groupId), 10),
  );
}

export async function getGroupId(tabId: number): Promise<unknown> {
  return api().sessions.getTabValue(tabId, 'groupId');
}

export async function getAllTabsInWindow(): Promise<Tab[]> {
  return api().tabs.query({ currentWindow: true });
}

export async function forEachTab(
  callback: (tab: Tab) => Promise<void>,
): Promise<void> {
  const tabs = await getAllTabsInWindow();
  await Promise.all(tabs.map(async (tab) => callback(tab)));
}

export async function forEachTabSync(
  callback: (tab: Tab) => void,
): Promise<void> {
  const tabs = await getAllTabsInWindow();
  tabs.forEach((tab) => {
    callback(tab);
  });
}
