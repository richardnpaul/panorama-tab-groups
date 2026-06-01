import {
  mod,
  getColorForGroupId,
  getLowestPositiveGroupId,
} from '../../src/js/background/utils.js';

describe('Background Utils', () => {
  describe('mod', () => {
    it('handles positive numbers', () => {
      expect(mod(5, 3)).toBe(2);
      expect(mod(3, 3)).toBe(0);
      expect(mod(0, 3)).toBe(0);
    });

    it('handles negative numbers mathematically correctly', () => {
      // JavaScript's -1 % 3 is -1, but mathematical modulo is 2
      expect(mod(-1, 3)).toBe(2);
      expect(mod(-4, 3)).toBe(2);
      expect(mod(-3, 3)).toBe(0);
    });
  });

  describe('getColorForGroupId', () => {
    it('returns colors in a cycle', () => {
      expect(getColorForGroupId(0)).toBe('grey');
      expect(getColorForGroupId(1)).toBe('blue');
      expect(getColorForGroupId(8)).toBe('orange');

      // Cycle wraps around
      expect(getColorForGroupId(9)).toBe('grey');
      expect(getColorForGroupId(10)).toBe('blue');
    });

    it('handles NaN or negative safely (if applicable)', () => {
      // JavaScript array access with negative indices returns undefined
      // If we don't handle negative group IDs, we should know what it returns
      // mod hasn't been used inside getColorForGroupId, it uses % directly
      expect(getColorForGroupId(-1)).toBeUndefined();
    });
  });

  describe('getLowestPositiveGroupId', () => {
    it('returns undefined for empty or null array', () => {
      expect(getLowestPositiveGroupId([])).toBeUndefined();
      expect(getLowestPositiveGroupId(null)).toBeUndefined();
      expect(getLowestPositiveGroupId(undefined)).toBeUndefined();
    });

    it('returns lowest positive ID', () => {
      const groups = [{ id: 5 }, { id: 2 }, { id: 8 }];
      expect(getLowestPositiveGroupId(groups)).toBe(2);
    });

    it('handles 0 correctly', () => {
      const groups = [{ id: 5 }, { id: 0 }, { id: 8 }];
      expect(getLowestPositiveGroupId(groups)).toBe(0);
    });

    it('ignores negative IDs and non-numbers', () => {
      const groups = [
        { id: -1 },
        { id: -2 },
        { id: 'not a number' },
        { id: 3 },
        { id: 1 },
      ];
      expect(getLowestPositiveGroupId(groups)).toBe(1);
    });

    it('returns undefined if no positive IDs exist', () => {
      const groups = [{ id: -1 }, { id: -2 }, { id: 'string' }];
      expect(getLowestPositiveGroupId(groups)).toBeUndefined();
    });
  });
});
