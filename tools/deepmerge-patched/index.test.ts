import { describe, expect, it } from 'vitest';
import { isRecord } from '../../src/js/share/guards.js';
import deepmerge from './index.js';

const poisoned = (): unknown => JSON.parse('{"__proto__":{"polluted":true}}');

/** What a merge made, which is an object when objects were merged */
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error('not an object');
  }
  return value;
}

/** What a merge made, which is an array when arrays were merged */
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error('not an array');
  }
  return value;
}

describe('tools/deepmerge-patched', () => {
  describe('merging', () => {
    it('merges nested objects without changing either side', () => {
      const target = { a: { b: 1, c: 2 }, d: 1 };
      const source = { a: { c: 3, e: 4 }, f: 5 };

      expect(deepmerge(target, source)).toEqual({
        a: { b: 1, c: 3, e: 4 },
        d: 1,
        f: 5,
      });
      expect(target).toEqual({ a: { b: 1, c: 2 }, d: 1 });
      expect(source).toEqual({ a: { c: 3, e: 4 }, f: 5 });
    });

    it('copies what the target lacks instead of sharing it', () => {
      const source = { inner: { list: [{ x: 1 }] } };

      const merged = record(deepmerge({}, source));

      expect(merged).toEqual(source);
      expect(merged.inner).not.toBe(source.inner);
      expect(list(record(merged.inner).list)[0]).not.toBe(source.inner.list[0]);
    });

    it('joins arrays, copying their elements', () => {
      const first = { x: 1 };

      const merged = list(deepmerge([first], [{ y: 2 }]));

      expect(merged).toEqual([{ x: 1 }, { y: 2 }]);
      expect(merged[0]).not.toBe(first);
    });

    it('takes a copy of the source where an array meets an object', () => {
      expect(deepmerge({ a: [1] }, { a: { b: 1 } })).toEqual({ a: { b: 1 } });
      expect(deepmerge({ a: { b: 1 } }, { a: [1] })).toEqual({ a: [1] });
    });

    it('keeps values that are not objects, null among them', () => {
      expect(deepmerge({ a: 1, b: null }, { a: 2, c: null })).toEqual({
        a: 2,
        b: null,
        c: null,
      });
      expect(deepmerge({ a: { b: 1 } }, { a: null })).toEqual({ a: null });
    });

    it('does not look into dates and regular expressions', () => {
      const date = new Date(0);
      const pattern = /x/u;

      const merged = record(deepmerge({}, { date, pattern }));

      expect(merged.date).toBe(date);
      expect(merged.pattern).toBe(pattern);
    });

    it('merges properties named by symbols, but only those that can be enumerated', () => {
      const shown = Symbol('shown');
      const hidden = Symbol('hidden');
      const source = { [shown]: 1 };
      Object.defineProperty(source, hidden, { value: 2, enumerable: false });

      const merged = record(deepmerge({}, source));

      expect(Reflect.get(merged, shown)).toBe(1);
      expect(Object.getOwnPropertySymbols(merged)).toEqual([shown]);
    });

    it('makes properties that can be written, listed and configured, as assignment would', () => {
      const merged = deepmerge({ a: 1 }, { b: { c: 2 } });

      expect(Object.getOwnPropertyDescriptor(merged, 'a')).toEqual({
        value: 1,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      expect(Object.getOwnPropertyDescriptor(merged, 'b')).toEqual({
        value: { c: 2 },
        writable: true,
        enumerable: true,
        configurable: true,
      });
    });

    it('merges into something that is not an object', () => {
      expect(deepmerge('text', { a: 1 })).toEqual({ a: 1 });
    });

    it('merges into nothing, which has no properties to protect', () => {
      expect(deepmerge(null, { toString: 1 })).toEqual({ toString: 1 });
    });

    it('does not take what a function holds that cannot be enumerated', () => {
      expect(deepmerge(() => 1, { name: 'x', free: 1 })).toEqual({ free: 1 });
    });

    it('does not take what the target holds up its prototype chain or cannot enumerate', () => {
      const target = {};
      Object.setPrototypeOf(target, { inherited: 1 });
      Object.defineProperty(target, 'hidden', { value: 1, enumerable: false });

      expect(
        deepmerge(target, { inherited: 2, hidden: 2, toString: 3, free: 4 }),
      ).toEqual({ free: 4 });
    });
  });

  describe('options', () => {
    it('leaves the options of the caller as they were', () => {
      const options = {};

      deepmerge({ a: [1] }, { a: [2] }, options);

      expect(options).toEqual({});
    });

    it('lets arrayMerge decide how arrays are joined, with the helper to copy', () => {
      const merged = deepmerge(
        { a: [1, 2] },
        { a: [3] },
        {
          arrayMerge: (_target, source, options) =>
            source.map((element) =>
              options.cloneUnlessOtherwiseSpecified?.(element, options),
            ),
        },
      );

      expect(merged).toEqual({ a: [3] });
    });

    it('does not let the caller replace the helper that copies', () => {
      let seen: unknown;

      deepmerge([1], [2], {
        cloneUnlessOtherwiseSpecified: () => 'replaced',
        arrayMerge: (_target, _source, options) => {
          seen = options.cloneUnlessOtherwiseSpecified?.({ x: 1 }, options);
          return [];
        },
      });

      expect(seen).toEqual({ x: 1 });
    });

    it('shares objects instead of copying them when clone is false', () => {
      const inner = { x: 1 };

      const merged = record(deepmerge({}, { inner }, { clone: false }));

      expect(merged.inner).toBe(inner);
    });

    it('treats as objects only what isMergeableObject says', () => {
      const inner = { x: 1 };

      const merged = record(
        deepmerge(
          { a: { y: 1 } },
          { a: inner },
          { isMergeableObject: () => false },
        ),
      );

      expect(merged.a).toBe(inner);
    });

    it('asks customMerge for the function that merges each key', () => {
      const keys: (string | symbol)[] = [];

      const merged = deepmerge(
        { a: { n: 1 }, b: { n: 1 } },
        { a: { n: 2 }, b: { n: 2 } },
        {
          customMerge: (key) => {
            keys.push(key);
            return key === 'a'
              ? (target: unknown, source: unknown) => ({
                  target,
                  source,
                })
              : undefined;
          },
        },
      );

      expect(merged).toEqual({
        a: { target: { n: 1 }, source: { n: 2 } },
        b: { n: 2 },
      });
      expect(keys).toEqual(['a', 'b']);
    });

    it('falls back to merging when customMerge gives something that is not a function', () => {
      const merged = deepmerge(
        { a: { n: 1, m: 1 } },
        { a: { n: 2 } },
        { customMerge: () => 5 },
      );

      expect(merged).toEqual({ a: { n: 2, m: 1 } });
    });
  });

  describe('all', () => {
    it('merges every item of the array, from an empty object', () => {
      expect(deepmerge.all([{ a: 1 }, { b: 2 }, { a: 3 }])).toEqual({
        a: 3,
        b: 2,
      });
      expect(deepmerge.all([])).toEqual({});
    });

    it('passes the options on', () => {
      expect(
        deepmerge.all([{ a: [1] }, { a: [2] }], {
          arrayMerge: (_target, source) => source,
        }),
      ).toEqual({ a: [2] });
    });

    it('refuses anything but an array', () => {
      expect(() => deepmerge.all({})).toThrow(
        'first argument should be an array',
      );
    });
  });

  describe('prototype poisoning (GHSA-gcqx-w48m-w2h4)', () => {
    it('does not let a target with its own __proto__ set the prototype of the result', () => {
      const merged = record(deepmerge(poisoned(), { a: 1 }));

      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
      expect(merged.polluted).toBeUndefined();
      expect(Object.keys(merged)).toEqual(['__proto__', 'a']);
    });

    it('does not let a source with its own __proto__ set the prototype of the result', () => {
      const merged = record(deepmerge(Object.create(null), poisoned()));

      expect(Object.getPrototypeOf(merged)).toBe(Object.prototype);
      expect(merged.polluted).toBeUndefined();
    });

    it('does not pollute objects made afterwards', () => {
      deepmerge(poisoned(), poisoned());
      deepmerge({}, poisoned());

      expect(record({}).polluted).toBeUndefined();
    });
  });
});
