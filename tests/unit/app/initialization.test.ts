import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import {
  createInitialization,
  INITIALIZATION_WAIT_MS,
} from '../../../src/js/app/initialization.js';

function setUp() {
  const clock = createMemoryClock(7000);
  const scheduler = createMemoryScheduler();
  const logger = { warn: vi.fn() };
  return {
    initialization: createInitialization({ clock, scheduler, logger }),
    clock,
    scheduler,
    logger,
  };
}

// Whether a promise has settled, without waiting for one that has not
const settled = async (promise: Promise<void>): Promise<boolean> => {
  let done = false;
  promise
    .then(() => {
      done = true;
    })
    .catch(() => undefined);
  await Promise.resolve();
  await Promise.resolve();
  return done;
};

describe('app/initialization.ts', () => {
  it('is under way before it has begun, so that early events wait', () => {
    const { initialization } = setUp();

    expect(initialization.isInitializing()).toBe(true);
    expect(initialization.startedAt()).toBeNull();
  });

  it('waits eleven seconds for the ten second start-up', () => {
    expect(INITIALIZATION_WAIT_MS).toBe(11000);
  });

  describe('begin', () => {
    it('notes the time it began', () => {
      const env = setUp();

      env.initialization.begin();

      expect(env.initialization.startedAt()).toBe(7000);
    });

    it('is under way again after it was over', () => {
      const env = setUp();
      env.initialization.finish();

      env.initialization.begin();

      expect(env.initialization.isInitializing()).toBe(true);
    });
  });

  describe('finish', () => {
    it('is over', () => {
      const env = setUp();

      env.initialization.finish();

      expect(env.initialization.isInitializing()).toBe(false);
    });

    it('lets those who wait go ahead, and stops their timers', async () => {
      const env = setUp();
      const first = env.initialization.waitForInitialization();
      const second = env.initialization.waitForInitialization();

      env.initialization.finish();

      expect(await settled(first)).toBe(true);
      expect(await settled(second)).toBe(true);
      expect(env.scheduler.pending()).toBe(0);
      expect(env.logger.warn).not.toHaveBeenCalled();
    });

    it('does not let those who wait later go ahead before it is over again', async () => {
      const env = setUp();
      env.initialization.finish();
      env.initialization.begin();

      const waiting = env.initialization.waitForInitialization();

      expect(await settled(waiting)).toBe(false);
    });

    it('does nothing more when it is over again', () => {
      const env = setUp();
      env.initialization.finish();

      expect(() => {
        env.initialization.finish();
      }).not.toThrow();
    });
  });

  describe('waitForInitialization', () => {
    it('goes ahead at once when the start-up is over', async () => {
      const env = setUp();
      env.initialization.finish();

      const waiting = env.initialization.waitForInitialization();

      expect(await settled(waiting)).toBe(true);
      expect(env.scheduler.pending()).toBe(0);
    });

    it('waits while the start-up is under way', async () => {
      const env = setUp();

      const waiting = env.initialization.waitForInitialization();

      expect(await settled(waiting)).toBe(false);
    });

    it('gives up after the time allowed, and says so', async () => {
      const env = setUp();
      const waiting = env.initialization.waitForInitialization();

      env.scheduler.advance(INITIALIZATION_WAIT_MS - 1);
      expect(await settled(waiting)).toBe(false);
      env.scheduler.advance(1);
      await waiting;

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Initialization] waitForInitialization timed out',
      );
    });

    it('does not complain when the start-up ended while it waited', async () => {
      const env = setUp();
      const waiting = env.initialization.waitForInitialization();
      env.scheduler.advance(1000);

      env.initialization.finish();
      await waiting;

      expect(env.logger.warn).not.toHaveBeenCalled();
    });
  });
});
