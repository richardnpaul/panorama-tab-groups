import type { SessionHistory } from '../../ports/session-history.js';

export interface MemorySessionHistory extends SessionHistory {
  /** Make the history unavailable, for this reason */
  disable(reason: string): void;
}

/** A session history that is there unless told otherwise */
export function createMemorySessionHistory(): MemorySessionHistory {
  let failure: Error | undefined;

  return {
    probe: () => (failure ? Promise.reject(failure) : Promise.resolve()),
    disable(reason) {
      failure = new Error(reason);
    },
  };
}
