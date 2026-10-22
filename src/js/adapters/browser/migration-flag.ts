import type { MigrationFlag } from '../../ports/migration-flag.js';

const KEY = 'hybridGroupsMigrationComplete';

/** The part of `browser.storage.local` the flag lives in */
export interface MigrationFlagApi {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, boolean>): Promise<void>;
    };
  };
}

export function createBrowserMigrationFlag(
  getApi: () => MigrationFlagApi,
): MigrationFlag {
  return {
    async isComplete() {
      const stored = await getApi().storage.local.get(KEY);
      return stored[KEY] === true;
    },
    setComplete: (complete) => getApi().storage.local.set({ [KEY]: complete }),
  };
}
