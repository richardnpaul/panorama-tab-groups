import { describe, expect, it } from 'vitest';
import {
  groupIdOfMenuItem,
  neighbourOf,
} from '../../../src/js/core/menu-items.js';

describe('core/menu-items.ts', () => {
  describe('groupIdOfMenuItem', () => {
    it.each([
      ['3', 3],
      ['0', 0],
      ['-2', -2],
      ['120', 120],
      [7, 7],
      [0, 0],
      [-1, -1],
    ])('reads %j as the group %j', (id, group) => {
      expect(groupIdOfMenuItem(id)).toBe(group);
    });

    it.each([
      ['refresh-groups'],
      ['send-tab'],
      [''],
      ['3a'],
      ['a3'],
      [' 3'],
      ['3 '],
      ['1.5'],
      ['--1'],
      ['+1'],
      [1.5],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [undefined],
      [null],
      [{}],
    ])('does not read %j as a group', (id) => {
      expect(groupIdOfMenuItem(id)).toBeUndefined();
    });
  });

  describe('neighbourOf', () => {
    it('is the tab before it', () => {
      expect(neighbourOf(2, [1, 2, 3])).toBe(1);
    });

    it('is the tab after it when it is the first', () => {
      expect(neighbourOf(1, [1, 2, 3])).toBe(2);
    });

    it('is the tab before it when it is the last', () => {
      expect(neighbourOf(3, [1, 2, 3])).toBe(2);
    });

    it('is the tab itself when it is the only one', () => {
      expect(neighbourOf(1, [1])).toBe(1);
    });

    it('is the tab itself when it is not among the visible tabs', () => {
      expect(neighbourOf(9, [1, 2])).toBe(9);
    });

    it('is the tab itself when there are no visible tabs', () => {
      expect(neighbourOf(9, [])).toBe(9);
    });

    it('goes by position, not by the number of the tab', () => {
      expect(neighbourOf(30, [50, 30, 10])).toBe(50);
    });
  });
});
