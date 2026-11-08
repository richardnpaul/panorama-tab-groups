import type { PendingUpdate } from '../../ports/pending-update.js';

export interface MemoryPendingUpdate extends PendingUpdate {
  /** Make every call from now on fail with this */
  failWith(error: Error | undefined): void;
}

/** A flag kept in memory, which is not set until it is */
export function createMemoryPendingUpdate(
  initial = false,
): MemoryPendingUpdate {
  let pending = initial;
  let failure: Error | undefined;

  return {
    failWith(error) {
      failure = error;
    },
    isPending: () =>
      failure === undefined
        ? Promise.resolve(pending)
        : Promise.reject(failure),
    set(next) {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      pending = next;
      return Promise.resolve();
    },
  };
}
