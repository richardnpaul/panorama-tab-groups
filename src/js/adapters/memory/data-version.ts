import type { DataVersion } from '../../ports/data-version.js';
import { isDataVersion } from '../../share/guards.js';

/** A version kept in memory, none until one is written; read back as the browser's is */
export function createMemoryDataVersion(initial?: number): DataVersion {
  let current = initial;

  return {
    read: () => Promise.resolve(isDataVersion(current) ? current : undefined),
    write(version) {
      current = version;
      return Promise.resolve();
    },
  };
}
