import { isRecord } from '../share/guards.js';
import { formatByteSize } from '../share/utils.js';
import { requireElementById } from '../share/dom.js';

type Tab = browser.tabs.Tab;

interface StatisticsApi {
  tabs: { query(queryInfo: Record<string, never>): Promise<Tab[]> };
  sessions: { getTabValue(tabId: number, key: string): Promise<unknown> };
  i18n: { getMessage(messageName: string): string };
}

const api = (): StatisticsApi => browser;

// A cached thumbnail is either a data URL or an object that holds one
function thumbnailSize(cached: unknown): number {
  if (typeof cached === 'string') {
    return cached.length;
  }
  if (isRecord(cached) && typeof cached.thumbnail === 'string') {
    return cached.thumbnail.length;
  }
  return 0;
}

async function tabThumbnailSize(tab: Tab): Promise<number> {
  if (tab.id === undefined) {
    return 0;
  }
  return thumbnailSize(await api().sessions.getTabValue(tab.id, 'thumbnail'));
}

export default async function getStatistics(): Promise<void> {
  const tabs = await api().tabs.query({});

  const sizes = await Promise.all(tabs.map(tabThumbnailSize));
  const totalSize = sizes.reduce((sum, size) => sum + size, 0);
  const numActiveTabs = tabs.filter((tab) => !tab.discarded).length;

  requireElementById(HTMLElement, 'thumbnailCacheSize').replaceChildren(
    document.createTextNode(formatByteSize(totalSize)),
  );

  requireElementById(HTMLElement, 'numberOfTabs').replaceChildren(
    document.createTextNode(
      `${String(tabs.length)} (${api().i18n.getMessage(
        'optionsStatisticsNumberOfTabsActive',
      )} ${String(numActiveTabs)})`,
    ),
  );
}
