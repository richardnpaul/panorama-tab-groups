import type { SessionsApi } from '../../src/js/adapters/browser/group-state.js';

/**
 * A stand-in for `browser.sessions` that keeps values the way the browser
 * does: as copies, so nothing is shared with the caller.
 */
export function createFakeSessions() {
  const windowValues = new Map<string, unknown>();
  const tabValues = new Map<string, unknown>();
  const slot = (id: number, key: string) => `${String(id)}:${key}`;

  const api: SessionsApi = {
    sessions: {
      getWindowValue: (windowId, key) =>
        Promise.resolve(structuredClone(windowValues.get(slot(windowId, key)))),
      setWindowValue: (windowId, key, value) => {
        windowValues.set(slot(windowId, key), structuredClone(value));
        return Promise.resolve();
      },
      getTabValue: (tabId, key) =>
        Promise.resolve(structuredClone(tabValues.get(slot(tabId, key)))),
      setTabValue: (tabId, key, value) => {
        tabValues.set(slot(tabId, key), structuredClone(value));
        return Promise.resolve();
      },
    },
  };

  return { api, windowValues, tabValues, slot };
}
