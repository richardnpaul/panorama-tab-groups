import { describe, expect, it, vi } from 'vitest';
import { createMemoryScheduler } from '../../../../src/js/adapters/memory/scheduler.js';
import { describeSchedulerContract } from '../../../support/scheduler-contract.js';

describeSchedulerContract('memory scheduler', () => {
  const scheduler = createMemoryScheduler();
  return {
    scheduler,
    advance: (ms) => {
      scheduler.advance(ms);
    },
  };
});

describe('adapters/memory/scheduler.ts', () => {
  it('starts at time 0 with nothing pending', () => {
    const scheduler = createMemoryScheduler();

    expect(scheduler.now()).toBe(0);
    expect(scheduler.pending()).toBe(0);
  });

  it('moves time forward by the amount advanced', () => {
    const scheduler = createMemoryScheduler();

    scheduler.advance(30);
    scheduler.advance(12);

    expect(scheduler.now()).toBe(42);
  });

  it('counts the timers still waiting', () => {
    const scheduler = createMemoryScheduler();
    const handle = scheduler.setTimeout(vi.fn(), 10);
    scheduler.setTimeout(vi.fn(), 20);
    expect(scheduler.pending()).toBe(2);

    scheduler.clearTimeout(handle);
    expect(scheduler.pending()).toBe(1);

    scheduler.advance(20);
    expect(scheduler.pending()).toBe(0);
  });

  it('measures a delay from the time the timer was set', () => {
    const scheduler = createMemoryScheduler();
    const callback = vi.fn();
    scheduler.advance(1000);

    scheduler.setTimeout(callback, 100);
    scheduler.advance(99);
    expect(callback).not.toHaveBeenCalled();

    scheduler.advance(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('shows the time each callback ran at', () => {
    const scheduler = createMemoryScheduler();
    const ranAt: number[] = [];
    scheduler.setTimeout(() => ranAt.push(scheduler.now()), 100);
    scheduler.setTimeout(() => ranAt.push(scheduler.now()), 250);

    scheduler.advance(300);

    expect(ranAt).toEqual([100, 250]);
    expect(scheduler.now()).toBe(300);
  });

  it('treats a negative delay as no delay', () => {
    const scheduler = createMemoryScheduler();
    const callback = vi.fn();
    scheduler.setTimeout(callback, -50);

    scheduler.advance(0);

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not run a timer that is still ahead of the time advanced', () => {
    const scheduler = createMemoryScheduler();
    const callback = vi.fn();
    scheduler.setTimeout(callback, 100);

    scheduler.advance(50);

    expect(callback).not.toHaveBeenCalled();
    expect(scheduler.pending()).toBe(1);
  });
});
