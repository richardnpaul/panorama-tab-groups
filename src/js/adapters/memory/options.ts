import {
  createDefaultOptions,
  parseOptions,
  type Options,
} from '../../core/options.js';
import type { OptionsStore } from '../../ports/options.js';

export interface MemoryOptions extends OptionsStore {
  /** What is kept, as storage would have it: any value under any key */
  readonly stored: Record<string, unknown>;
}

/** The user's settings, kept in memory as copies, the way storage keeps them */
export function createMemoryOptions({
  defaults = createDefaultOptions('1.0', true),
  stored = {},
}: {
  defaults?: Options;
  stored?: Record<string, unknown>;
} = {}): MemoryOptions {
  const kept: Record<string, unknown> = structuredClone(stored);

  return {
    stored: kept,
    load: () =>
      Promise.resolve(
        parseOptions(structuredClone({ ...defaults, ...kept }), defaults),
      ),
    isSet: (name) => Promise.resolve(name in kept),
    save(changes) {
      Object.assign(kept, structuredClone(changes));
      return Promise.resolve();
    },
  };
}
