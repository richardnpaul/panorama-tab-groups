import type { MigrationFlag } from '../../ports/migration-flag.js';

export interface MemoryMigrationFlag extends MigrationFlag {
  /** Make every call from now on fail with this */
  failWith(error: Error): void;
}

/** A flag that is not set until it is */
export function createMemoryMigrationFlag(
  complete = false,
): MemoryMigrationFlag {
  let current = complete;
  let failure: Error | undefined;

  return {
    failWith(error) {
      failure = error;
    },
    isComplete: () =>
      failure ? Promise.reject(failure) : Promise.resolve(current),
    setComplete(next) {
      if (failure) {
        return Promise.reject(failure);
      }
      current = next;
      return Promise.resolve();
    },
  };
}
