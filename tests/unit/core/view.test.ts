import { describe, expect, it } from 'vitest';
import { mostRecentOtherTab } from '../../../src/js/core/view.js';

const tab = (id: number, lastAccessed: number) => ({
  id,
  pinned: false,
  lastAccessed,
});

describe('core/view.ts', () => {
  describe('mostRecentOtherTab', () => {
    it('is the tab used last other than the view', () => {
      expect(
        mostRecentOtherTab([tab(1, 100), tab(2, 300), tab(3, 200)], 9),
      ).toBe(2);
    });

    it('leaves the view out even when it was used last', () => {
      expect(
        mostRecentOtherTab([tab(1, 100), tab(9, 900), tab(3, 200)], 9),
      ).toBe(3);
    });

    it('is the first of tabs used at the same moment', () => {
      expect(
        mostRecentOtherTab([tab(5, 100), tab(6, 100), tab(7, 100)], 9),
      ).toBe(5);
    });

    it('is the only other tab', () => {
      expect(mostRecentOtherTab([tab(9, 5), tab(4, 0)], 9)).toBe(4);
    });

    it('is nothing when the view is the only tab', () => {
      expect(mostRecentOtherTab([tab(9, 5)], 9)).toBeUndefined();
    });

    it('is nothing when there are no tabs', () => {
      expect(mostRecentOtherTab([], 9)).toBeUndefined();
    });
  });
});
