import { describe, expect, it } from 'vitest';
import {
  gridRect,
  isNavKey,
  matchingTabs,
  mostRecent,
  moveGroupTo,
  nextGroupName,
  navigate,
  searchGroups,
  searchMode,
  type NavKey,
  type NavPosition,
} from '../../../src/js/core/popup.js';

const tab = (title: string, url: string | undefined) => ({ title, url });

describe('core/popup.ts', () => {
  describe('searchMode', () => {
    it.each([
      ['', 'groups'],
      ['a', 'keep'],
      ['ab', 'results'],
      ['abc', 'results'],
    ] as const)('for %j is %s', (query, mode) => {
      expect(searchMode(query)).toBe(mode);
    });
  });

  describe('matchingTabs', () => {
    const tabs = [
      tab('Alpha page', 'https://one.test/'),
      tab('Beta', 'https://two.test/ALPHA'),
      tab('Gamma', undefined),
      tab('Delta', 'https://three.test/'),
    ];

    it('finds the text in a title or an address, whatever the case', () => {
      expect(matchingTabs(tabs, 'alpha').map(({ title }) => title)).toEqual([
        'Alpha page',
        'Beta',
      ]);
      expect(matchingTabs(tabs, 'GAMMA')).toEqual([tab('Gamma', undefined)]);
    });

    it('finds the text in the address of a tab', () => {
      expect(matchingTabs(tabs, 'three.test')).toEqual([tabs[3]]);
    });

    it('does not find what a tab has no address for', () => {
      expect(matchingTabs(tabs, 'undefined')).toEqual([]);
    });

    it.each(['.*', '(', '[a-z]+', 'a|b', '\\'])(
      'takes %j as the text it is, not as a pattern',
      (query) => {
        expect(matchingTabs([tab('Has a|b in it', 'x')], query)).toEqual(
          query === 'a|b' ? [tab('Has a|b in it', 'x')] : [],
        );
      },
    );

    it('finds a tab with the special characters of patterns in its title', () => {
      const special = tab('What (is) this? [a-z]+', 'x');

      expect(matchingTabs([special], '(is)')).toEqual([special]);
      expect(matchingTabs([special], '[a-z]+')).toEqual([special]);
      expect(matchingTabs([special], 'is.this')).toEqual([]);
    });
  });

  describe('searchGroups', () => {
    const groups = [
      {
        id: 1,
        name: 'One',
        tabs: [tab('Alpha', 'https://x.test/'), tab('Beta', 'https://x.test/')],
      },
      { id: 2, name: 'Two', tabs: [tab('Gamma', 'https://x.test/')] },
      {
        id: 3,
        name: 'Three',
        tabs: [
          tab('Alphabet', 'https://x.test/'),
          tab('Alpha two', 'https://x.test/'),
        ],
      },
    ];

    it('keeps the groups with a match, each with only the tabs that match', () => {
      expect(searchGroups(groups, 'alpha')).toEqual([
        { group: groups[0], tabs: [tab('Alpha', 'https://x.test/')] },
        {
          group: groups[2],
          tabs: [
            tab('Alphabet', 'https://x.test/'),
            tab('Alpha two', 'https://x.test/'),
          ],
        },
      ]);
    });

    it('gives the groups themselves', () => {
      expect(searchGroups(groups, 'gamma')[0]?.group).toBe(groups[1]);
    });

    it('leaves the groups it was given as they were', () => {
      searchGroups(groups, 'alpha');

      expect(groups[0]?.tabs).toHaveLength(2);
    });

    it('gives nothing when nothing matches', () => {
      expect(searchGroups(groups, 'zzz')).toEqual([]);
    });
  });

  describe('nextGroupName', () => {
    it.each([
      ['Old', 'New', 'New'],
      ['Old', '  New name  ', 'New name'],
      ['Old', '', 'Old'],
      ['Old', '   ', 'Old'],
      ['Old', '\t\n', 'Old'],
      ['Old', 'Old', 'Old'],
    ])('for %j typed over %j is %j', (current, typed, expected) => {
      expect(nextGroupName(current, typed)).toBe(expected);
    });
  });

  describe('mostRecent', () => {
    const used = (name: string, lastAccessed: number) => ({
      name,
      lastAccessed,
    });

    it('is the one used last', () => {
      expect(mostRecent([used('a', 5), used('b', 9), used('c', 7)])?.name).toBe(
        'b',
      );
      expect(mostRecent([used('a', 9), used('b', 5)])?.name).toBe('a');
      expect(mostRecent([used('a', 1), used('b', 2)])?.name).toBe('b');
    });

    it('is the first of those used at the same time', () => {
      expect(mostRecent([used('a', 4), used('b', 4)])?.name).toBe('a');
    });

    it('is nothing for those never used, or for none', () => {
      expect(mostRecent([used('a', 0), used('b', 0)])).toBeNull();
      expect(mostRecent([])).toBeNull();
    });
  });

  describe('moveGroupTo', () => {
    it.each([
      // [ids, id, gap, result]
      [[1, 2, 3, 4], 1, 0, [1, 2, 3, 4]],
      [[1, 2, 3, 4], 1, 1, [1, 2, 3, 4]],
      [[1, 2, 3, 4], 1, 2, [2, 1, 3, 4]],
      [[1, 2, 3, 4], 1, 3, [2, 3, 1, 4]],
      [[1, 2, 3, 4], 1, 4, [2, 3, 4, 1]],
      [[1, 2, 3, 4], 4, 0, [4, 1, 2, 3]],
      [[1, 2, 3, 4], 4, 2, [1, 2, 4, 3]],
      [[1, 2, 3, 4], 4, 3, [1, 2, 3, 4]],
      [[1, 2, 3, 4], 4, 4, [1, 2, 3, 4]],
      [[1, 2, 3, 4], 3, 1, [1, 3, 2, 4]],
      [[1, 2, 3, 4], 2, 4, [1, 3, 4, 2]],
      [[1, 2, 3, 4], 2, 9, [1, 3, 4, 2]],
      [[7], 7, 0, [7]],
      [[7], 7, 1, [7]],
    ])('puts %j %j at the gap %j: %j', (ids, id, gap, expected) => {
      expect(moveGroupTo(ids, id, gap)).toEqual(expected);
    });

    it('leaves the order alone for a group that is not there', () => {
      const ids = [1, 2, 3];

      const result = moveGroupTo(ids, 9, 1);

      expect(result).toEqual([1, 2, 3]);
      expect(result).not.toBe(ids);
    });

    it('does not change the list it was given', () => {
      const ids = [1, 2, 3];

      moveGroupTo(ids, 3, 0);

      expect(ids).toEqual([1, 2, 3]);
    });
  });

  describe('gridRect', () => {
    it.each([
      // [index, count, rect]
      [0, 1, { x: 0, y: 0, w: 0.25, h: 0.5 }],
      [1, 2, { x: 0.25, y: 0, w: 0.25, h: 0.5 }],
      [3, 4, { x: 0.75, y: 0, w: 0.25, h: 0.5 }],
      [4, 5, { x: 0, y: 0.5, w: 0.25, h: 0.5 }],
      [7, 8, { x: 0.75, y: 0.5, w: 0.25, h: 0.5 }],
      [8, 8, { x: 0, y: 0, w: 0.25, h: 0.5 }],
      [0, 9, { x: 0, y: 0, w: 1 / 6, h: 1 / 3 }],
      [8, 9, { x: 2 / 6, y: 1 / 3, w: 1 / 6, h: 1 / 3 }],
      [17, 18, { x: 5 / 6, y: 2 / 3, w: 1 / 6, h: 1 / 3 }],
      [18, 18, { x: 0, y: 0, w: 1 / 6, h: 1 / 3 }],
      [0, 19, { x: 0, y: 0, w: 1 / 8, h: 1 / 4 }],
      [31, 32, { x: 7 / 8, y: 3 / 4, w: 1 / 8, h: 1 / 4 }],
      [32, 33, { x: 0, y: 0, w: 1 / 8, h: 1 / 4 }],
    ])('puts group %j of %j at %j', (index, count, rect) => {
      expect(gridRect(index, count)).toEqual(rect);
    });
  });

  describe('isNavKey', () => {
    it.each(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])(
      'accepts %s',
      (key) => {
        expect(isNavKey(key)).toBe(true);
      },
    );

    it.each(['Enter', 'a', '', 'arrowup', 'Escape'])('rejects %j', (key) => {
      expect(isNavKey(key)).toBe(false);
    });
  });

  describe('navigate', () => {
    const at = (row: number, column: number, wanted = column): NavPosition => ({
      row,
      column,
      wanted,
    });
    const rows = [3, 2, 4];

    it.each([
      // [key, from, to]
      ['ArrowDown', at(0, 1), at(1, 1)],
      ['ArrowDown', at(1, 1), at(2, 1)],
      ['ArrowDown', at(2, 1), at(0, 1)],
      ['ArrowUp', at(2, 1), at(1, 1)],
      ['ArrowUp', at(1, 1), at(0, 1)],
      ['ArrowUp', at(0, 1), at(2, 1)],
      ['ArrowRight', at(0, 0), at(0, 1)],
      ['ArrowRight', at(0, 2), at(0, 0)],
      ['ArrowLeft', at(2, 3), at(2, 2)],
      ['ArrowLeft', at(2, 0), at(2, 3)],
    ] as const satisfies readonly [NavKey, NavPosition, NavPosition][])(
      '%s from %j goes to %j',
      (key, from, to) => {
        expect(navigate(key, rows, from)).toEqual(to);
      },
    );

    it('keeps to the place it was last at, as far as the row reaches', () => {
      // From the fourth of a long row, down to a row of two, and on
      const short = navigate('ArrowDown', rows, at(0, 2, 3));

      expect(short).toEqual({ row: 1, column: 1, wanted: 3 });
      expect(navigate('ArrowDown', rows, short ?? at(0, 0))).toEqual({
        row: 2,
        column: 3,
        wanted: 3,
      });
    });

    it('takes the place it moved to along a row as the one to keep to', () => {
      expect(navigate('ArrowRight', rows, at(2, 1, 0))).toEqual({
        row: 2,
        column: 2,
        wanted: 2,
      });
      expect(navigate('ArrowLeft', rows, at(2, 1, 3))).toEqual({
        row: 2,
        column: 0,
        wanted: 0,
      });
    });

    it('goes nowhere to a row with nothing to focus', () => {
      expect(navigate('ArrowDown', [2, 0, 2], at(0, 0))).toBeNull();
      expect(navigate('ArrowUp', [2, 0, 2], at(2, 0))).toBeNull();
    });

    it('goes nowhere along a row with nothing to focus, or that is not there', () => {
      expect(navigate('ArrowRight', [0], at(0, 0))).toBeNull();
      expect(navigate('ArrowLeft', [2], at(5, 0))).toBeNull();
    });

    it('goes nowhere when there are no rows', () => {
      expect(navigate('ArrowDown', [], at(0, 0))).toBeNull();
    });

    it('stays on the only item of the only row', () => {
      expect(navigate('ArrowDown', [1], at(0, 0))).toEqual(at(0, 0));
      expect(navigate('ArrowRight', [1], at(0, 0))).toEqual(at(0, 0));
    });
  });
});
