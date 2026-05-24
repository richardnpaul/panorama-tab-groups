import { formatByteSize } from '../share/utils.js';

export default async function getStatistics() {
  const tabs = await browser.tabs.query({});

  let totalSize = 0;
  let numActiveTabs = 0;

  await Promise.all(
    tabs.map(async (tab) => {
      const thumbnail = await browser.sessions.getTabValue(tab.id, 'thumbnail');

      if (thumbnail) {
        if (thumbnail.thumbnail) {
          totalSize += thumbnail.thumbnail.length;
        } else {
          totalSize += thumbnail.length;
        }
      }
      if (!tab.discarded) {
        numActiveTabs += 1;
      }
    }),
  );
  console.debug(numActiveTabs);

  document
    .getElementById('thumbnailCacheSize')
    .replaceChildren(document.createTextNode(formatByteSize(totalSize)));

  document
    .getElementById('numberOfTabs')
    .replaceChildren(
      document.createTextNode(
        `${tabs.length} (${browser.i18n.getMessage(
          'optionsStatisticsNumberOfTabsActive',
        )} ${numActiveTabs})`,
      ),
    );
}
