import { INITIALIZATION_TIMEOUT_MS } from '../core/constants.js';
import type { Clock } from '../ports/clock.js';
import type { Logger } from '../ports/logger.js';
import type { Scheduler } from '../ports/scheduler.js';

/** How long a handler waits for the start-up to finish: its limit and a second */
export const INITIALIZATION_WAIT_MS = INITIALIZATION_TIMEOUT_MS + 1000;

export interface InitializationDeps {
  clock: Clock;
  scheduler: Scheduler;
  logger: Pick<Logger, 'warn'>;
}

/** Where the start-up that recovers the group of every tab has got to */
export interface Initialization {
  isInitializing: () => boolean;
  /** When the start-up began, in milliseconds since the epoch */
  startedAt: () => number | null;
  /** The start-up begins, or begins again */
  begin: () => void;
  /** The start-up is over, or given up on: those waiting go ahead */
  finish: () => void;
  /** Settles once the start-up is over, or has been waited on long enough */
  waitForInitialization: () => Promise<void>;
}

export function createInitialization({
  clock,
  scheduler,
  logger,
}: InitializationDeps): Initialization {
  // Events can come before the start-up has begun, and must wait for it
  let initializing = true;
  let started: number | null = null;
  let waiting: (() => void)[] = [];
  const isInitializing = (): boolean => initializing;

  return {
    isInitializing,
    startedAt: () => started,

    begin() {
      initializing = true;
      started = clock.now();
    },

    finish() {
      initializing = false;
      const release = waiting;
      waiting = [];
      release.forEach((go) => {
        go();
      });
    },

    async waitForInitialization() {
      if (!isInitializing()) {
        return;
      }

      await new Promise<void>((resolve) => {
        const timer = scheduler.setTimeout(resolve, INITIALIZATION_WAIT_MS);
        waiting.push(() => {
          scheduler.clearTimeout(timer);
          resolve();
        });
      });

      if (isInitializing()) {
        logger.warn('[Initialization] waitForInitialization timed out');
      }
    },
  };
}
