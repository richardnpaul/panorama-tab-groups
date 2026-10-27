import { describe, expect, it } from 'vitest';
import {
  classesWithPrefix,
  effectiveTheme,
  neighbourTabId,
  searchedTabId,
  tabToPutBefore,
  type NavGroup,
} from '../../../src/js/core/view-nav.js';

const group = (groupId: number, ...tabIds: number[]): NavGroup => ({
  groupId,
  tabIds,
});

describe('core/view-nav.ts', () => {
  describe('neighbourTabId', () => {
    const groups = [
      group(1, 10, 11, 12),
      group(2),
      group(3, 30, 31),
      group(4, 40),
    ];

    it('is the next tab of the group going forward', () => {
      expect(neighbourTabId(groups, 10, 1)).toBe(11);
      expect(neighbourTabId(groups, 11, 1)).toBe(12);
    });

    it('is the previous tab of the group going back', () => {
      expect(neighbourTabId(groups, 12, -1)).toBe(11);
      expect(neighbourTabId(groups, 11, -1)).toBe(10);
    });

    it('is the first tab of the next group that has tabs, past the end of a group', () => {
      expect(neighbourTabId(groups, 12, 1)).toBe(30);
      expect(neighbourTabId(groups, 31, 1)).toBe(40);
    });

    it('is the last tab of the previous group that has tabs, past the start of a group', () => {
      expect(neighbourTabId(groups, 30, -1)).toBe(12);
      expect(neighbourTabId(groups, 40, -1)).toBe(31);
    });

    it('goes round from the last group to the first going forward', () => {
      expect(neighbourTabId(groups, 40, 1)).toBe(10);
    });

    it('goes round from the first group to the last going back', () => {
      expect(neighbourTabId(groups, 10, -1)).toBe(40);
    });

    it('goes round within the only group that has tabs', () => {
      const only = [group(1), group(2, 20, 21, 22)];

      expect(neighbourTabId(only, 22, 1)).toBe(20);
      expect(neighbourTabId(only, 20, -1)).toBe(22);
    });

    it('stays on the only tab there is', () => {
      const one = [group(1, 5)];

      expect(neighbourTabId(one, 5, 1)).toBe(5);
      expect(neighbourTabId(one, 5, -1)).toBe(5);
    });

    it('is nothing when the active tab is in none of the groups', () => {
      expect(neighbourTabId(groups, 99, 1)).toBeUndefined();
      expect(neighbourTabId([], 1, 1)).toBeUndefined();
    });

    it('finds the group by the tab, whichever group number it has', () => {
      expect(neighbourTabId([group(7, 1, 2)], 1, 1)).toBe(2);
    });

    it('moves from the tab 0, which is numbered 0', () => {
      expect(neighbourTabId([group(1, 0, 1)], 0, 1)).toBe(1);
      expect(neighbourTabId([group(1, 1, 0)], 1, 1)).toBe(0);
    });
  });

  describe('searchedTabId', () => {
    const tabs = [
      { id: 1, title: 'Alpha Page' },
      { id: 2, title: 'Beta page' },
      { id: 3, title: 'Gamma' },
    ];

    it('is the last tab whose title has the text', () => {
      expect(searchedTabId(tabs, 'page', 9)).toBe(2);
    });

    it('ignores the case of both', () => {
      expect(searchedTabId(tabs, 'ALPHA', 9)).toBe(1);
      expect(searchedTabId(tabs, 'gAmMa', 9)).toBe(3);
    });

    it('is the tab that was active when none matches', () => {
      expect(searchedTabId(tabs, 'delta', 9)).toBe(9);
    });

    it('matches the middle of a title', () => {
      expect(searchedTabId(tabs, 'mm', 9)).toBe(3);
    });

    it('is the last tab for no text, which every title has', () => {
      expect(searchedTabId(tabs, '', 9)).toBe(3);
    });

    it('is the tab that was active when there are no tabs', () => {
      expect(searchedTabId([], 'a', 9)).toBe(9);
    });

    it('can find the tab 0', () => {
      expect(searchedTabId([{ id: 0, title: 'Zero' }], 'zero', 9)).toBe(0);
    });
  });

  describe('effectiveTheme', () => {
    it.each([
      ['auto', true, 'dark'],
      ['auto', false, 'light'],
      ['dark', false, 'dark'],
      ['light', true, 'light'],
      ['solarized', true, 'solarized'],
    ])(
      'for %s with a system that prefers dark: %s is %s',
      (preference, dark, expected) => {
        expect(effectiveTheme(preference, dark)).toBe(expected);
      },
    );
  });

  describe('classesWithPrefix', () => {
    it('gives the classes that start with the prefix and a dash', () => {
      expect(
        classesWithPrefix(
          ['view-ready', 'theme-dark', 'toolbar-top', 'theme-x'],
          'theme',
        ),
      ).toEqual(['theme-dark', 'theme-x']);
    });

    it('leaves out a class that only starts like the prefix', () => {
      expect(
        classesWithPrefix(['themed', 'theme', 'theme-a'], 'theme'),
      ).toEqual(['theme-a']);
    });

    it('is nothing for no classes', () => {
      expect(classesWithPrefix([], 'theme')).toEqual([]);
    });
  });

  describe('tabToPutBefore', () => {
    const shown = [
      { id: 7, index: 4 },
      { id: 5, index: 2 },
      { id: 9, index: 8 },
    ];

    it('is the tab with the next higher place', () => {
      expect(tabToPutBefore(3, shown)).toBe(7);
      expect(tabToPutBefore(0, shown)).toBe(5);
    });

    it('is nothing when the tab goes last', () => {
      expect(tabToPutBefore(8, shown)).toBeUndefined();
      expect(tabToPutBefore(20, shown)).toBeUndefined();
    });

    it('does not take a tab that has the same place', () => {
      expect(tabToPutBefore(4, shown)).toBe(9);
    });

    it('is nothing when nothing is shown', () => {
      expect(tabToPutBefore(1, [])).toBeUndefined();
    });

    it('can be the tab 0, with the place after the first', () => {
      expect(tabToPutBefore(-1, [{ id: 0, index: 0 }])).toBe(0);
    });
  });
});
