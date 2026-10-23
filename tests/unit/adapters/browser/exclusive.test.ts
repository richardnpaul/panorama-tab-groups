import { describe, expect, it } from 'vitest';
import { createExclusively } from '../../../../src/js/adapters/browser/exclusive.js';
import { createFakeLocks } from '../../../support/fake-locks.js';

const later = () => Promise.resolve();

describe('adapters/browser/exclusive.ts', () => {
  describe('with locks', () => {
    it('runs the task under the lock of the extension and gives its result', async () => {
      const fake = createFakeLocks();
      const exclusively = createExclusively(fake.locks);

      await expect(exclusively(() => Promise.resolve(7))).resolves.toBe(7);

      expect(fake.requests).toEqual(['panorama-sessions']);
    });

    it('passes on a failure of the task', async () => {
      const failure = new Error('no');
      const exclusively = createExclusively(createFakeLocks().locks);

      await expect(exclusively(() => Promise.reject(failure))).rejects.toBe(
        failure,
      );
    });

    it('takes turns with another that shares the locks', async () => {
      const { locks } = createFakeLocks();
      const here = createExclusively(locks);
      const there = createExclusively(locks);
      const log: string[] = [];
      const task = (name: string) => async () => {
        log.push(`${name} start`);
        await later();
        await later();
        log.push(`${name} end`);
      };

      await Promise.all([here(task('a')), there(task('b'))]);

      expect(log).toEqual(['a start', 'a end', 'b start', 'b end']);
    });

    it('asks for the lock once for every task', async () => {
      const fake = createFakeLocks();
      const exclusively = createExclusively(fake.locks);

      await Promise.all([
        exclusively(() => Promise.resolve(1)),
        exclusively(() => Promise.resolve(2)),
      ]);

      expect(fake.requests).toHaveLength(2);
    });
  });

  describe('without locks', () => {
    it('gives the result of the task', async () => {
      const exclusively = createExclusively(undefined);

      await expect(exclusively(() => Promise.resolve('done'))).resolves.toBe(
        'done',
      );
    });

    it('runs tasks one after the other, in the order they were given', async () => {
      const exclusively = createExclusively(undefined);
      const log: string[] = [];
      const task = (name: string) => async () => {
        log.push(`${name} start`);
        await later();
        await later();
        log.push(`${name} end`);
      };

      await Promise.all([exclusively(task('a')), exclusively(task('b'))]);

      expect(log).toEqual(['a start', 'a end', 'b start', 'b end']);
    });

    it('passes on a failure, and still runs the tasks after it', async () => {
      const exclusively = createExclusively(undefined);
      const failure = new Error('no');

      const failing = exclusively(() => Promise.reject(failure));
      const next = exclusively(() => Promise.resolve('after'));

      await expect(failing).rejects.toBe(failure);
      await expect(next).resolves.toBe('after');
    });

    it('does not take turns with another that has its own queue', async () => {
      const here = createExclusively(undefined);
      const there = createExclusively(undefined);
      const log: string[] = [];
      const task = (name: string) => async () => {
        log.push(`${name} start`);
        await later();
        await later();
        log.push(`${name} end`);
      };

      await Promise.all([here(task('a')), there(task('b'))]);

      expect(log).toEqual(['a start', 'b start', 'a end', 'b end']);
    });
  });
});
