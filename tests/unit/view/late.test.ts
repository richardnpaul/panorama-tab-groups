import { describe, expect, it } from 'vitest';
import { createLate } from '../../../src/js/view/late.js';

describe('view/late.ts', () => {
  it('fails before it is bound', () => {
    expect(() => createLate<number>().get()).toThrow('This is not ready yet');
  });

  it('gives the value once it is bound', () => {
    const late = createLate<number>();

    late.bind(5);

    expect(late.get()).toBe(5);
  });

  it('can be bound to a value that is undefined or 0', () => {
    const undefinedLate = createLate<string | undefined>();
    const zeroLate = createLate<number>();

    undefinedLate.bind(undefined);
    zeroLate.bind(0);

    const values: unknown[] = [undefinedLate.get(), zeroLate.get()];
    expect(values).toEqual([undefined, 0]);
  });

  it('gives the value bound last', () => {
    const late = createLate<string>();

    late.bind('first');
    late.bind('second');

    expect(late.get()).toBe('second');
  });
});
