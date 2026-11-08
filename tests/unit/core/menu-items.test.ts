import { describe, expect, it } from 'vitest';
import {
  groupOfMenuItem,
  menuItemId,
  neighbourOf,
} from '../../../src/js/core/menu-items.js';

describe('core/menu-items.ts', () => {
  describe('menuItemId', () => {
    it.each([
      [1, 0, '1:0'],
      [1, -2, '1:-2'],
      [42, 7, '42:7'],
    ])('names window %i group %i as %s', (windowId, groupId, expected) => {
      expect(menuItemId(windowId, groupId)).toBe(expected);
    });
  });

  describe('groupOfMenuItem', () => {
    it.each([
      ['1:3', { windowId: 1, groupId: 3 }],
      ['1:0', { windowId: 1, groupId: 0 }],
      ['1:-2', { windowId: 1, groupId: -2 }],
      ['42:120', { windowId: 42, groupId: 120 }],
    ])('reads %j as %j', (id, group) => {
      expect(groupOfMenuItem(id)).toEqual(group);
    });

    it.each([
      ['3'],
      ['-2'],
      ['refresh-groups'],
      ['send-tab'],
      [''],
      ['1:'],
      [':1'],
      ['-1:0'],
      ['1:3a'],
      ['a1:3'],
      [' 1:3'],
      ['1:3 '],
      ['1:1.5'],
      ['1:--1'],
      ['1:+1'],
      ['1:2:3'],
      [7],
      [0],
      [-1],
    ])('does not read %j as a group', (id) => {
      expect(groupOfMenuItem(id)).toBeUndefined();
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
