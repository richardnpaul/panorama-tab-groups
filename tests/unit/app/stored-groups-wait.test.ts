import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import {
  GROUPS_WAIT_EVERY_MS,
  GROUPS_WAIT_TRIES,
  waitForStoredGroups,
} from '../../../src/js/app/stored-groups-wait.js';
import type { Group } from '../../../src/js/ports/group-state.js';

const group: Group = { id: 0, name: 'G0', rect: { x: 0, y: 0, w: 1, h: 1 } };

function setUp() {
  const groupState = createMemoryGroupState();
  const scheduler = createMemoryScheduler();
  const logger = { warn: vi.fn() };
  let settled = false;
  const start = () =>
    waitForStoredGroups(groupState, scheduler, logger, 1).then(() => {
      settled = true;
    });
  /** Time passes, and what its timers started is done */
  const wait = async (ms: number) => {
    scheduler.advance(ms);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  };
  return {
    groupState,
    scheduler,
    logger,
    start,
    wait,
    settled: () => settled,
  };
}

describe('app/stored-groups-wait.ts', () => {
  it('settles at once for a window that has groups', async () => {
    const env = setUp();
    await env.groupState.setGroups(1, [group]);

    await env.start();

    expect(env.scheduler.pending()).toBe(0);
    expect(env.logger.warn).not.toHaveBeenCalled();
  });

  it('waits for the groups the background makes for a new window', async () => {
    const env = setUp();
    const waiting = env.start();
    await env.wait(0);
    expect(env.settled()).toBe(false);

    await env.groupState.setGroups(1, [group]);
    await env.wait(GROUPS_WAIT_EVERY_MS - 1);
    expect(env.settled()).toBe(false);
    await env.wait(1);

    await waiting;
    expect(env.settled()).toBe(true);
    expect(env.scheduler.pending()).toBe(0);
  });

  it('takes an empty list of groups, or only system groups, for none', async () => {
    const env = setUp();
    const ungrouped: Group = { ...group, id: -2, name: 'Ungrouped Tabs' };
    const viewer: Group = { ...group, id: -1, name: 'View' };
    await env.groupState.setGroups(1, []);
    const getGroups = vi.spyOn(env.groupState, 'getGroups');
    const waiting = env.start();
    await env.wait(0);

    await env.groupState.setGroups(1, [ungrouped, viewer]);
    await env.wait(GROUPS_WAIT_EVERY_MS);

    expect(getGroups).toHaveBeenCalledTimes(2);
    expect(env.settled()).toBe(false);
    // A user group comes alongside the system group, and the wait is over
    await env.groupState.setGroups(1, [ungrouped, group]);
    await env.wait(GROUPS_WAIT_EVERY_MS);
    await waiting;
    expect(env.settled()).toBe(true);
  });

  it('gives up after a few seconds, so the page is shown all the same', async () => {
    const env = setUp();
    const getGroups = vi.spyOn(env.groupState, 'getGroups');
    const waiting = env.start();
    await env.wait(0);

    // Each look sets the timer of the next
    await Array.from({ length: GROUPS_WAIT_TRIES - 2 }).reduce<Promise<void>>(
      (done) => done.then(() => env.wait(GROUPS_WAIT_EVERY_MS)),
      Promise.resolve(),
    );
    expect(env.settled()).toBe(false);
    await env.wait(GROUPS_WAIT_EVERY_MS);

    await waiting;
    expect(getGroups).toHaveBeenCalledTimes(GROUPS_WAIT_TRIES);
    expect(env.scheduler.pending()).toBe(0);
    expect(env.logger.warn).toHaveBeenCalledWith(
      '[View] Window 1 has no groups after 3 seconds; shown without them',
    );
  });
});
