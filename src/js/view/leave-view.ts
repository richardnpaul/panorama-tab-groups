import type { Logger } from '../ports/logger.js';
import type { ViewTabs } from '../ports/view-tabs.js';

export interface LeaveViewDeps {
  tabs: Pick<ViewTabs, 'currentId' | 'close'>;
  // The path of the page this runs in
  pathname: () => string;
  logger: Pick<Logger, 'debug'>;
}

/**
 * Close the tab the view is in, after the user has chosen what to look at
 * instead. Only the view that has a tab to itself is closed: the popup is not
 * a tab.
 */
export function createLeaveView({
  tabs,
  pathname,
  logger,
}: LeaveViewDeps): () => Promise<void> {
  return async () => {
    if (!pathname().includes('view.html')) {
      return;
    }
    try {
      await tabs.close(await tabs.currentId());
    } catch (error) {
      // The tab may be gone already
      logger.debug('Could not close the view tab:', error);
    }
  };
}
