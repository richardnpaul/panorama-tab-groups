import { describe, expect, it } from 'vitest';
import {
  isBoolean,
  isNumber,
  isRecord,
  isString,
  messageOf,
} from '../../../src/js/share/guards.js';

const samples: Record<string, unknown> = {
  string: 'text',
  emptyString: '',
  number: 0,
  nan: NaN,
  true: true,
  false: false,
  null: null,
  undefined,
  object: { a: 1 },
  emptyObject: {},
  array: [1],
  function: () => 1,
  symbol: Symbol('s'),
  bigint: 1n,
};

function namesWhere(guard: (value: unknown) => boolean): string[] {
  return Object.entries(samples)
    .filter(([, value]) => guard(value))
    .map(([name]) => name);
}

describe('share/guards.ts', () => {
  it('isString accepts only strings', () => {
    expect(namesWhere(isString)).toEqual(['string', 'emptyString']);
  });

  it('isNumber accepts only numbers', () => {
    expect(namesWhere(isNumber)).toEqual(['number', 'nan']);
  });

  it('isBoolean accepts only booleans', () => {
    expect(namesWhere(isBoolean)).toEqual(['true', 'false']);
  });

  it('isRecord accepts objects and arrays but not null or functions', () => {
    expect(namesWhere(isRecord)).toEqual(['object', 'emptyObject', 'array']);
  });

  describe('messageOf', () => {
    it('gives the message of an error', () => {
      expect(messageOf(new Error('went wrong'))).toBe('went wrong');
      expect(messageOf(new TypeError('bad type'))).toBe('bad type');
    });

    it('gives anything else as text', () => {
      expect(messageOf('plain text')).toBe('plain text');
      expect(messageOf(42)).toBe('42');
      expect(messageOf(null)).toBe('null');
      expect(messageOf(undefined)).toBe('undefined');
      expect(messageOf({ message: 'not an error' })).toBe('[object Object]');
    });
  });
});
