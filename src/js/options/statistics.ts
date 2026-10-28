import type { I18n } from '../ports/i18n.js';
import type { ViewState } from '../ports/view-state.js';
import type { ViewTabs } from '../ports/view-tabs.js';
import { requireElementById } from '../share/dom.js';
import { formatByteSize } from '../share/utils.js';

export interface StatisticsPorts {
  viewTabs: Pick<ViewTabs, 'listAll'>;
  viewState: Pick<ViewState, 'thumbnail'>;
  i18n: I18n;
}

/** Show how many tabs there are and how much room their thumbnails take */
export function createStatistics({
  viewTabs,
  viewState,
  i18n,
}: StatisticsPorts): () => Promise<void> {
  const thumbnailSize = async (tabId: number): Promise<number> =>
    (await viewState.thumbnail(tabId))?.image.length ?? 0;

  return async () => {
    const tabs = await viewTabs.listAll();

    const sizes = await Promise.all(tabs.map(({ id }) => thumbnailSize(id)));
    const totalSize = sizes.reduce((sum, size) => sum + size, 0);
    const numActiveTabs = tabs.filter((tab) => !tab.discarded).length;

    requireElementById(HTMLElement, 'thumbnailCacheSize').replaceChildren(
      document.createTextNode(formatByteSize(i18n, totalSize)),
    );

    requireElementById(HTMLElement, 'numberOfTabs').replaceChildren(
      document.createTextNode(
        `${String(tabs.length)} (${i18n.getMessage(
          'optionsStatisticsNumberOfTabsActive',
        )} ${String(numActiveTabs)})`,
      ),
    );
  };
}
