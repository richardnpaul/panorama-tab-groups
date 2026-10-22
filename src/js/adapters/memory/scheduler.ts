import type { Scheduler, TimerHandle } from '../../ports/scheduler.js';

export interface MemoryScheduler extends Scheduler {
  /** The current time, which starts at 0 and only moves in `advance` */
  now(): number;
  /** Move time forward, running every timer that comes due on the way */
  advance(ms: number): void;
  /** How many timers are waiting */
  pending(): number;
}

interface Timer {
  handle: TimerHandle;
  dueAt: number;
  callback: () => void;
}

/** A scheduler on manual time, for tests that must not wait */
export function createMemoryScheduler(): MemoryScheduler {
  const timers: Timer[] = [];
  let current = 0;
  let lastHandle = 0;

  // The timer to run next: the earliest due, the first set among equals
  const nextDue = (until: number): Timer | undefined =>
    timers
      .filter(({ dueAt }) => dueAt <= until)
      .reduce<
        Timer | undefined
      >((earliest, timer) => (earliest === undefined || timer.dueAt < earliest.dueAt ? timer : earliest), undefined);

  const remove = (handle: TimerHandle): void => {
    const index = timers.findIndex((timer) => timer.handle === handle);
    if (index !== -1) {
      timers.splice(index, 1);
    }
  };

  return {
    now: () => current,

    pending: () => timers.length,

    setTimeout(callback, delayMs) {
      lastHandle += 1;
      timers.push({
        handle: lastHandle,
        dueAt: current + Math.max(delayMs, 0),
        callback,
      });
      return lastHandle;
    },

    clearTimeout: remove,

    advance(ms) {
      const target = current + ms;
      for (let timer = nextDue(target); timer; timer = nextDue(target)) {
        remove(timer.handle);
        current = Math.max(current, timer.dueAt);
        timer.callback();
      }
      current = target;
    },
  };
}
