import type { Clock } from '../../ports/clock.js';

export interface MemoryClock extends Clock {
  set(timeMs: number): void;
  advance(ms: number): void;
}

/** A clock that only moves when told to */
export function createMemoryClock(startMs = 0): MemoryClock {
  let current = startMs;

  return {
    now: () => current,
    set(timeMs) {
      current = timeMs;
    },
    advance(ms) {
      current += ms;
    },
  };
}
