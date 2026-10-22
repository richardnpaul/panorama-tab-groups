import type { Scheduler } from '../../ports/scheduler.js';

/**
 * The runtime's own timers behind the Scheduler port. A browser's setTimeout
 * already gives a number; where it gives a timer object, `Number()` is its id,
 * which clearTimeout accepts.
 */
export function createSystemScheduler(): Scheduler {
  return {
    setTimeout: (callback, delayMs) => Number(setTimeout(callback, delayMs)),
    clearTimeout: (handle) => {
      clearTimeout(handle);
    },
  };
}
