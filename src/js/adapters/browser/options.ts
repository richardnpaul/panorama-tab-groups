import {
  createDefaultOptions,
  parseOptions,
  type Options,
} from '../../core/options.js';
import type { OptionsStore } from '../../ports/options.js';
import {
  detectCapabilities,
  type CapabilityApi,
} from '../../share/capabilities.js';

/** The part of the browser the options are kept in, and their defaults come from */
export interface OptionsApi extends CapabilityApi {
  runtime: { getManifest(): { version: string } };
  storage: {
    sync: {
      get(keys: Options): Promise<Record<string, unknown>>;
      set(items: Partial<Options>): Promise<void>;
    };
  };
}

export function createBrowserOptions(getApi: () => OptionsApi): OptionsStore {
  return {
    async load() {
      const api = getApi();
      const defaults = createDefaultOptions(
        api.runtime.getManifest().version,
        detectCapabilities(api).hasTabGroups,
      );
      return parseOptions(await api.storage.sync.get(defaults), defaults);
    },
    save: (changes) => getApi().storage.sync.set(changes),
  };
}
