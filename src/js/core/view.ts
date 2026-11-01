import type { TabSummary } from '../ports/tabs.js';

/**
 * The tab to go back to when the view is left: the one used last
 * before it. Of tabs used at the same moment, the first in the window.
 */
export function mostRecentOtherTab(
  tabs: readonly TabSummary[],
  viewTabId: number,
): number | undefined {
  return tabs
    .filter(({ id }) => id !== viewTabId)
    .reduce<TabSummary | undefined>(
      (latest, tab) =>
        latest === undefined || tab.lastAccessed > latest.lastAccessed
          ? tab
          : latest,
      undefined,
    )?.id;
}
