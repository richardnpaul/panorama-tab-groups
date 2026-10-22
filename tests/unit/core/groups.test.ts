import { describe, expect, it } from 'vitest';
import { ensureUngroupedGroup } from '../../../src/js/core/groups.js';
import type { Group } from '../../../src/js/ports/group-state.js';

const NOW = 1_700_000_000_000;

const userGroup = (id: number): Group => ({
  id,
  name: `Group ${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
});

const ungrouped: Group = {
  id: -2,
  name: 'Ungrouped Tabs',
  containerId: 'browser-default',
  nativeGroupId: null,
  rect: { x: 0, y: 0, w: 0, h: 0 },
  lastMoved: NOW,
  isSystemGroup: true,
};

describe('core/groups.ts', () => {
  describe('ensureUngroupedGroup', () => {
    it('adds the system group for ungrouped tabs when it is missing', () => {
      const result = ensureUngroupedGroup([userGroup(1), userGroup(2)], NOW);

      expect(result).toEqual([userGroup(1), userGroup(2), ungrouped]);
    });

    it('puts the system group last', () => {
      const result = ensureUngroupedGroup([userGroup(5)], NOW);

      expect(result.map((group) => group.id)).toEqual([5, -2]);
    });

    it('creates the system group alone for an empty list', () => {
      expect(ensureUngroupedGroup([], NOW)).toEqual([ungrouped]);
    });

    it.each([null, undefined])(
      'creates the system group alone for %s',
      (groups) => {
        expect(ensureUngroupedGroup(groups, NOW)).toEqual([ungrouped]);
      },
    );

    it('stamps the new system group with the time it was made', () => {
      const [group] = ensureUngroupedGroup([], 42);

      expect(group?.lastMoved).toBe(42);
    });

    it('does not change the list it was given', () => {
      const groups = [userGroup(1)];

      ensureUngroupedGroup(groups, NOW);

      expect(groups).toEqual([userGroup(1)]);
    });

    it('restores the fixed fields of an existing system group', () => {
      const tampered: Group = {
        ...ungrouped,
        name: 'Renamed',
        isSystemGroup: false,
        nativeGroupId: 17,
        lastMoved: 5,
      };

      const result = ensureUngroupedGroup([userGroup(1), tampered], NOW);

      expect(result).toEqual([
        userGroup(1),
        { ...ungrouped, lastMoved: 5, nativeGroupId: null },
      ]);
    });

    it('keeps the position of an existing system group', () => {
      const result = ensureUngroupedGroup(
        [userGroup(1), ungrouped, userGroup(2)],
        NOW,
      );

      expect(result.map((group) => group.id)).toEqual([1, -2, 2]);
    });

    it('leaves the other groups as they are', () => {
      const first = userGroup(1);

      const result = ensureUngroupedGroup([first, ungrouped], NOW);

      expect(result[0]).toBe(first);
    });

    it('only fixes the first system group if there are two', () => {
      const duplicate = { ...ungrouped, name: 'Second' };

      const result = ensureUngroupedGroup(
        [{ ...ungrouped, name: 'First' }, duplicate],
        NOW,
      );

      expect(result[0]?.name).toBe('Ungrouped Tabs');
      expect(result[1]).toBe(duplicate);
    });

    it('does not add a second system group when one exists', () => {
      expect(
        ensureUngroupedGroup([ungrouped], NOW).filter(({ id }) => id === -2),
      ).toHaveLength(1);
    });
  });
});
