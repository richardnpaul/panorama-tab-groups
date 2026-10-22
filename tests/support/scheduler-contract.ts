import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Scheduler } from '../../src/js/ports/scheduler.js';

export interface SchedulerUnderTest {
  scheduler: Scheduler;
  /** Let this much time pass, running every timer that comes due */
  advance(ms: number): void;
}

/** What every Scheduler must do, so the manual-time fake matches real timers */
export function describeSchedulerContract(
  name: string,
  create: () => SchedulerUnderTest,
): void {
  describe(`Scheduler contract: ${name}`, () => {
    let subject: SchedulerUnderTest;
    let scheduler: Scheduler;

    beforeEach(() => {
      subject = create();
      ({ scheduler } = subject);
    });

    it('runs the callback once the delay has passed, and not before', () => {
      const callback = vi.fn();
      scheduler.setTimeout(callback, 100);

      subject.advance(99);
      expect(callback).not.toHaveBeenCalled();

      subject.advance(1);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('runs the callback only once', () => {
      const callback = vi.fn();
      scheduler.setTimeout(callback, 10);

      subject.advance(10);
      subject.advance(1000);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('runs a callback with no delay on the next tick of time', () => {
      const callback = vi.fn();
      scheduler.setTimeout(callback, 0);

      expect(callback).not.toHaveBeenCalled();
      subject.advance(0);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('runs timers in the order they come due', () => {
      const order: string[] = [];
      scheduler.setTimeout(() => order.push('slow'), 300);
      scheduler.setTimeout(() => order.push('fast'), 100);
      scheduler.setTimeout(() => order.push('middle'), 200);

      subject.advance(300);

      expect(order).toEqual(['fast', 'middle', 'slow']);
    });

    it('runs timers that come due together in the order they were set', () => {
      const order: string[] = [];
      scheduler.setTimeout(() => order.push('first'), 100);
      scheduler.setTimeout(() => order.push('second'), 100);

      subject.advance(100);

      expect(order).toEqual(['first', 'second']);
    });

    it('does not run a timer that was cleared', () => {
      const callback = vi.fn();
      const handle = scheduler.setTimeout(callback, 50);

      scheduler.clearTimeout(handle);
      subject.advance(100);

      expect(callback).not.toHaveBeenCalled();
    });

    it('only clears the timer it was given', () => {
      const kept = vi.fn();
      const cleared = vi.fn();
      scheduler.setTimeout(kept, 50);
      scheduler.clearTimeout(scheduler.setTimeout(cleared, 50));

      subject.advance(50);

      expect(kept).toHaveBeenCalledTimes(1);
      expect(cleared).not.toHaveBeenCalled();
    });

    it('does nothing when a timer is cleared twice or after it ran', () => {
      const callback = vi.fn();
      const handle = scheduler.setTimeout(callback, 10);
      subject.advance(10);

      expect(() => {
        scheduler.clearTimeout(handle);
        scheduler.clearTimeout(handle);
      }).not.toThrow();
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('gives out positive whole numbers as handles', () => {
      const handles = [1, 2, 3].map(() => scheduler.setTimeout(vi.fn(), 10));

      handles.forEach((handle) => {
        expect(Number.isInteger(handle)).toBe(true);
        expect(handle).toBeGreaterThan(0);
      });
    });

    it('leaves the other timers alone when a finished timer is cleared', () => {
      const finished = vi.fn();
      const waiting = vi.fn();
      const handle = scheduler.setTimeout(finished, 10);
      scheduler.setTimeout(waiting, 100);
      subject.advance(10);

      scheduler.clearTimeout(handle);
      subject.advance(90);

      expect(waiting).toHaveBeenCalledTimes(1);
    });

    it('gives out a different handle for each timer', () => {
      const handles = [1, 2, 3].map(() => scheduler.setTimeout(vi.fn(), 10));

      expect(new Set(handles).size).toBe(3);
    });

    it('runs a timer that a callback sets, when its own delay has passed', () => {
      const order: string[] = [];
      scheduler.setTimeout(() => {
        order.push('outer');
        scheduler.setTimeout(() => order.push('inner'), 50);
      }, 100);

      subject.advance(100);
      expect(order).toEqual(['outer']);

      subject.advance(49);
      expect(order).toEqual(['outer']);

      subject.advance(1);
      expect(order).toEqual(['outer', 'inner']);
    });

    it('runs a timer that a callback sets within the time being advanced', () => {
      const callback = vi.fn();
      scheduler.setTimeout(() => {
        scheduler.setTimeout(callback, 10);
      }, 10);

      subject.advance(20);

      expect(callback).toHaveBeenCalledTimes(1);
    });
  });
}
