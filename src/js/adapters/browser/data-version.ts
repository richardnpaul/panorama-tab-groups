import type { DataVersion } from '../../ports/data-version.js';
import { isDataVersion } from '../../share/guards.js';

const KEY = 'schemaVersion';

/** The part of `browser.storage.local` the version lives in */
export interface DataVersionApi {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, number>): Promise<void>;
    };
  };
}

export function createBrowserDataVersion(
  getApi: () => DataVersionApi,
): DataVersion {
  return {
    async read() {
      const stored = (await getApi().storage.local.get(KEY))[KEY];
      return isDataVersion(stored) ? stored : undefined;
    },
    write: (version) => getApi().storage.local.set({ [KEY]: version }),
  };
}
