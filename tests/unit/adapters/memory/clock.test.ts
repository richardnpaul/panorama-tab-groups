import { describe, expect, it } from 'vitest';
import { createMemoryClock } from '../../../../src/js/adapters/memory/clock.js';

describe('adapters/memory/clock.ts', () => {
  it('starts at 0 unless told otherwise', () => {
    expect(createMemoryClock().now()).toBe(0);
    expect(createMemoryClock(1234).now()).toBe(1234);
  });

  it('stays where it is until moved', () => {
    const clock = createMemoryClock(5);

    expect(clock.now()).toBe(clock.now());
    expect(clock.now()).toBe(5);
  });

  it('can be set to a time', () => {
    const clock = createMemoryClock(5);

    clock.set(100);

    expect(clock.now()).toBe(100);
  });

  it('can be moved forward', () => {
    const clock = createMemoryClock(10);

    clock.advance(5);
    clock.advance(20);

    expect(clock.now()).toBe(35);
  });
});
