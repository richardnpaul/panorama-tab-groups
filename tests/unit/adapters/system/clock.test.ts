import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { systemClock } from '../../../../src/js/adapters/system/clock.js';

describe('adapters/system/clock.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('tells the current time in milliseconds since the epoch', () => {
    vi.setSystemTime(1_700_000_000_123);

    expect(systemClock.now()).toBe(1_700_000_000_123);
  });

  it('follows the passing of time', () => {
    vi.setSystemTime(1000);
    const before = systemClock.now();

    vi.advanceTimersByTime(250);

    expect(systemClock.now() - before).toBe(250);
  });
});
