import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import {
  createViewOpening,
  VIEW_OPENING_TIMEOUT_MS,
} from '../../../src/js/app/view-opening.js';

function setUp() {
  const clock = createMemoryClock(5000);
  const scheduler = createMemoryScheduler();
  const logger = { debug: vi.fn(), warn: vi.fn() };
  return {
    opening: createViewOpening({ clock, scheduler, logger }),
    clock,
    scheduler,
    logger,
  };
}

describe('app/view-opening.ts', () => {
  it('is waiting for no view tab at first', () => {
    expect(setUp().opening.current()).toBeNull();
  });

  describe('begin', () => {
    it('starts waiting for a tab in the window, as of now, not knowing which one', () => {
      const env = setUp();

      env.opening.begin(3);

      expect(env.opening.current()).toEqual({
        tabId: null,
        windowId: 3,
        creationTimestamp: 5000,
      });
    });

    it('learns which tab the browser opened', () => {
      const env = setUp();

      env.opening.begin(3).opened(17);

      expect(env.opening.current()?.tabId).toBe(17);
    });

    it('does not remember a tab for a request that is over', () => {
      const env = setUp();
      const pending = env.opening.begin(3);
      env.opening.finish();

      pending.opened(17);

      expect(env.opening.current()).toBeNull();
    });

    it('does not remember a tab for a request that has been replaced', () => {
      const env = setUp();
      const first = env.opening.begin(3);
      env.opening.begin(4);

      first.opened(17);

      expect(env.opening.current()).toEqual({
        tabId: null,
        windowId: 4,
        creationTimestamp: 5000,
      });
    });

    it('replaces an earlier request and stops its timer', () => {
      const env = setUp();
      env.opening.begin(3);

      env.opening.begin(4);

      expect(env.scheduler.pending()).toBe(1);
    });

    it('is forgotten after the time allowed, with a warning', () => {
      const env = setUp();
      env.opening.begin(3);

      env.scheduler.advance(VIEW_OPENING_TIMEOUT_MS - 1);
      expect(env.opening.current()).not.toBeNull();
      env.scheduler.advance(1);

      expect(env.opening.current()).toBeNull();
      expect(env.logger.warn).toHaveBeenCalledWith(
        'View tab creation timed out, clearing state',
      );
    });

    it('waits five seconds', () => {
      expect(VIEW_OPENING_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('finish', () => {
    it('stops waiting and stops the timer', () => {
      const env = setUp();
      env.opening.begin(3);

      env.opening.finish();

      expect(env.opening.current()).toBeNull();
      expect(env.scheduler.pending()).toBe(0);
    });

    it('does nothing when nothing is being waited for', () => {
      const env = setUp();

      env.opening.finish();

      expect(env.opening.current()).toBeNull();
      expect(env.scheduler.pending()).toBe(0);
    });
  });

  describe('tabRemoved', () => {
    it('stops waiting when the tab asked for is closed', () => {
      const env = setUp();
      env.opening.begin(3).opened(17);

      env.opening.tabRemoved(17);

      expect(env.opening.current()).toBeNull();
      expect(env.scheduler.pending()).toBe(0);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'View tab removed during creation, cleared state',
      );
    });

    it('keeps waiting when another tab is closed', () => {
      const env = setUp();
      env.opening.begin(3).opened(17);

      env.opening.tabRemoved(18);

      expect(env.opening.current()?.tabId).toBe(17);
      expect(env.logger.debug).not.toHaveBeenCalled();
    });

    it('keeps waiting when the tab is not known yet', () => {
      const env = setUp();
      env.opening.begin(3);

      env.opening.tabRemoved(17);

      expect(env.opening.current()).not.toBeNull();
    });

    it('does nothing when nothing is being waited for', () => {
      const env = setUp();

      env.opening.tabRemoved(17);

      expect(env.logger.debug).not.toHaveBeenCalled();
    });
  });
});
