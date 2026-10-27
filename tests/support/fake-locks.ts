import type { Locks } from '../../src/js/adapters/browser/exclusive.js';

/** A stand-in for `navigator.locks` that is shared the way the real one is: by everyone */
export function createFakeLocks() {
  const requests: string[] = [];
  let queue: Promise<unknown> = Promise.resolve();

  const locks: Locks = {
    request: (name, callback) => {
      requests.push(name);
      const run = queue.then(callback);
      queue = run.catch(() => undefined);
      return run;
    },
  };

  return { locks, requests };
}
