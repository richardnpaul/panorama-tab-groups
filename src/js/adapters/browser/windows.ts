import type { Windows } from '../../ports/windows.js';

interface QueriedWindow {
  id?: number | undefined;
}

/** The part of `browser.windows` the extension uses */
export interface WindowsApi {
  windows: {
    getCurrent(): Promise<QueriedWindow>;
    getLastFocused(): Promise<QueriedWindow>;
    get(windowId: number): Promise<QueriedWindow>;
    getAll(getInfo: object): Promise<QueriedWindow[]>;
  };
}

function idOf({ id }: QueriedWindow): number {
  if (id === undefined) {
    throw new Error('No current window');
  }
  return id;
}

export function createBrowserWindows(getApi: () => WindowsApi): Windows {
  return {
    currentWindowId: async () => idOf(await getApi().windows.getCurrent()),
    lastFocusedWindowId: async () =>
      idOf(await getApi().windows.getLastFocused()),
    listIds: async () => {
      const windows = await getApi().windows.getAll({});
      return windows.flatMap(({ id }) => (id === undefined ? [] : [id]));
    },
    exists: async (windowId) => {
      try {
        await getApi().windows.get(windowId);
        return true;
      } catch {
        return false;
      }
    },
  };
}
