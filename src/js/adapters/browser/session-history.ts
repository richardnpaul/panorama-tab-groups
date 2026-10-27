import type { SessionHistory } from '../../ports/session-history.js';

/** The part of `browser.sessions` that tells what was closed */
export interface SessionHistoryApi {
  sessions: {
    getRecentlyClosed(filter: { maxResults: number }): Promise<unknown>;
  };
}

export function createBrowserSessionHistory(
  getApi: () => SessionHistoryApi,
): SessionHistory {
  return {
    async probe() {
      await getApi().sessions.getRecentlyClosed({ maxResults: 1 });
    },
  };
}
