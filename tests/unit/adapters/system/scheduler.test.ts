import { afterEach, beforeEach, vi } from 'vitest';
import { createSystemScheduler } from '../../../../src/js/adapters/system/scheduler.js';
import { describeSchedulerContract } from '../../../support/scheduler-contract.js';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describeSchedulerContract('system scheduler', () => ({
  scheduler: createSystemScheduler(),
  advance: (ms) => {
    vi.advanceTimersByTime(ms);
  },
}));
