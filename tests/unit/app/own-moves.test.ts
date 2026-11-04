import { describe, expect, it } from 'vitest';
import { createOwnMoves } from '../../../src/js/app/own-moves.js';

describe('app/own-moves.ts', () => {
  it('counts a tab as moved by the add-on while the work goes on, and not before or after', async () => {
    const moves = createOwnMoves();
    const seen: boolean[] = [moves.includes(1)];

    await moves.during([1, 2], () => {
      seen.push(moves.includes(1), moves.includes(2), moves.includes(3));
      return Promise.resolve();
    });
    seen.push(moves.includes(1), moves.includes(2));

    expect(seen).toEqual([false, true, true, false, false, false]);
  });

  it('gives what the work gives', async () => {
    await expect(
      createOwnMoves().during([1], () => Promise.resolve('done')),
    ).resolves.toBe('done');
  });

  it('stops counting the tab when the work fails, and passes the failure on', async () => {
    const moves = createOwnMoves();
    const failure = new Error('cannot move');

    await expect(moves.during([1], () => Promise.reject(failure))).rejects.toBe(
      failure,
    );

    expect(moves.includes(1)).toBe(false);
  });

  it('keeps counting a tab while any of two overlapping moves goes on', async () => {
    const moves = createOwnMoves();
    let finishFirst: () => void = () => undefined;
    const first = moves.during(
      [1],
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    );
    let seenInSecond = false;
    await moves.during([1], () => {
      seenInSecond = moves.includes(1);
      return Promise.resolve();
    });

    // The second is over, and the first still goes on
    expect(seenInSecond).toBe(true);
    expect(moves.includes(1)).toBe(true);

    finishFirst();
    await first;
    expect(moves.includes(1)).toBe(false);
  });
});
