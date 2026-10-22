import { describe, expect, it } from 'vitest';
import {
  checkActiveGroup,
  planVisibility,
  type VisibilityInput,
  type VisibilityTab,
} from '../../../src/js/core/visibility.js';
import type { Group } from '../../../src/js/ports/group-state.js';

const tab = (
  id: number,
  groupId: number | undefined,
  extra: Partial<VisibilityTab> = {},
): VisibilityTab => ({ id, groupId, pinned: false, lastAccessed: 0, ...extra });

const group = (id: number, nativeGroupId?: number | null): Group => ({
  id,
  name: `Group ${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
  ...(nativeGroupId === undefined ? {} : { nativeGroupId }),
});

const input = (overrides: Partial<VisibilityInput> = {}): VisibilityInput => ({
  activeGroup: 1,
  noTabSelected: false,
  tabs: [],
  groups: [],
  canHideTabs: true,
  ...overrides,
});

describe('core/visibility.ts', () => {
  describe('checkActiveGroup', () => {
    it.each([-1, 0, 1, 42])('accepts %s', (value) => {
      expect(checkActiveGroup(value)).toEqual({
        valid: true,
        activeGroup: value,
      });
    });

    it('says when there is no active group', () => {
      expect(checkActiveGroup(undefined)).toEqual({
        valid: false,
        problem: 'undefined',
      });
    });

    it.each([-2, -3, 1.5, -0.5, NaN, Infinity, 'invalid', '1', null, true, {}])(
      'does not accept %j',
      (value) => {
        expect(checkActiveGroup(value)).toEqual({
          valid: false,
          problem: 'invalid',
        });
      },
    );
  });

  describe('planVisibility', () => {
    describe('which tabs are shown', () => {
      it('shows the tabs of the active group and hides the rest', () => {
        const plan = planVisibility(
          input({
            tabs: [tab(1, 1), tab(2, 2), tab(3, 1), tab(4, 3)],
            activeGroup: 1,
          }),
        );

        expect(plan).toMatchObject({
          kind: 'apply',
          show: [1, 3],
          hide: [2, 4],
        });
      });

      it('keeps the order of the tabs', () => {
        const plan = planVisibility(
          input({ tabs: [tab(9, 2), tab(3, 2), tab(7, 1), tab(1, 1)] }),
        );

        expect(plan).toMatchObject({ show: [7, 1], hide: [9, 3] });
      });

      it('leaves pinned tabs alone, whatever their group', () => {
        const plan = planVisibility(
          input({
            tabs: [
              tab(1, 1),
              tab(2, 2, { pinned: true }),
              tab(3, 1, { pinned: true }),
            ],
          }),
        );

        expect(plan).toMatchObject({ show: [1], hide: [] });
      });

      it('shows the view tab only while the view is the active group', () => {
        const withView = [tab(1, -1), tab(2, 1)];

        expect(
          planVisibility(input({ tabs: withView, activeGroup: -1 })),
        ).toMatchObject({ show: [1], hide: [2] });
        expect(
          planVisibility(input({ tabs: withView, activeGroup: 1 })),
        ).toMatchObject({ show: [2], hide: [1] });
      });

      it('hides a tab that belongs to no group', () => {
        const plan = planVisibility(
          input({ tabs: [tab(1, undefined), tab(2, 1)] }),
        );

        expect(plan).toMatchObject({ show: [2], hide: [1] });
      });

      it('shows tabs of group 0', () => {
        const plan = planVisibility(
          input({ activeGroup: 0, tabs: [tab(1, 0), tab(2, 1)] }),
        );

        expect(plan).toMatchObject({ show: [1], hide: [2] });
      });
    });

    describe('when there would be nothing left to show', () => {
      it('aborts, so that not every tab is hidden', () => {
        const plan = planVisibility(
          input({ activeGroup: 2, tabs: [tab(1, 1), tab(2, 1), tab(3, 3)] }),
        );

        expect(plan).toEqual({ kind: 'abort', hiddenCount: 3 });
      });

      it('does not abort when at least one tab stays', () => {
        const plan = planVisibility(input({ tabs: [tab(1, 1), tab(2, 2)] }));

        expect(plan.kind).toBe('apply');
      });

      it('does not abort when there is nothing to hide either', () => {
        expect(planVisibility(input({ tabs: [] })).kind).toBe('apply');
        expect(
          planVisibility(input({ tabs: [tab(1, 2, { pinned: true })] })).kind,
        ).toBe('apply');
      });
    });

    describe('picking a tab to activate', () => {
      it('activates nothing unless no tab is selected', () => {
        const plan = planVisibility(
          input({
            tabs: [tab(1, 1, { lastAccessed: 10 })],
            noTabSelected: false,
          }),
        );

        expect(plan).toMatchObject({ activate: undefined });
      });

      it('activates the shown tab used most recently', () => {
        const plan = planVisibility(
          input({
            noTabSelected: true,
            tabs: [
              tab(1, 1, { lastAccessed: 100 }),
              tab(2, 2, { lastAccessed: 900 }),
              tab(3, 1, { lastAccessed: 300 }),
              tab(4, 1, { lastAccessed: 200 }),
            ],
          }),
        );

        expect(plan).toMatchObject({ activate: 3 });
      });

      it('takes the first of the shown tabs used equally recently', () => {
        const plan = planVisibility(
          input({
            noTabSelected: true,
            tabs: [
              tab(5, 1, { lastAccessed: 50 }),
              tab(6, 1, { lastAccessed: 50 }),
              tab(7, 1, { lastAccessed: 10 }),
            ],
          }),
        );

        expect(plan).toMatchObject({ activate: 5 });
      });

      it('activates nothing when there is no tab to show', () => {
        const plan = planVisibility(input({ noTabSelected: true, tabs: [] }));

        expect(plan).toMatchObject({ kind: 'apply', activate: undefined });
      });

      it('does not activate a hidden or pinned tab', () => {
        const plan = planVisibility(
          input({
            noTabSelected: true,
            tabs: [
              tab(1, 2, { lastAccessed: 999 }),
              tab(2, 1, { pinned: true, lastAccessed: 888 }),
              tab(3, 1, { lastAccessed: 1 }),
            ],
          }),
        );

        expect(plan).toMatchObject({ activate: 3 });
      });
    });

    describe('browsers that cannot hide tabs', () => {
      it('plans no hiding or showing, but still plans the native groups', () => {
        const plan = planVisibility(
          input({
            canHideTabs: false,
            tabs: [tab(1, 1), tab(2, 2)],
            groups: [group(1, 101), group(2, 102)],
          }),
        );

        expect(plan).toMatchObject({
          show: [],
          hide: [],
          collapse: [102],
          expand: 101,
        });
      });
    });

    describe('native groups', () => {
      it('collapses the native groups of the groups that are not active', () => {
        const plan = planVisibility(
          input({
            tabs: [tab(1, 1), tab(2, 2)],
            groups: [group(1, 101), group(2, 102), group(3, 103)],
          }),
        );

        expect(plan).toMatchObject({ collapse: [102, 103] });
      });

      it('skips groups without a native group', () => {
        const plan = planVisibility(
          input({
            tabs: [tab(1, 1), tab(2, 2)],
            groups: [group(2), group(3, null), group(4, 0), group(5, 105)],
          }),
        );

        expect(plan).toMatchObject({ collapse: [105] });
      });

      it('collapses nothing when no tab is hidden', () => {
        const plan = planVisibility(
          input({ tabs: [tab(1, 1)], groups: [group(1, 101), group(2, 102)] }),
        );

        expect(plan).toMatchObject({ collapse: [] });
      });

      it('expands the native group of the active group when a tab is shown', () => {
        const plan = planVisibility(
          input({
            tabs: [tab(1, 1)],
            groups: [group(1, 101), group(2, 102)],
          }),
        );

        expect(plan).toMatchObject({ expand: 101 });
      });

      it('expands nothing when no tab is shown', () => {
        const plan = planVisibility(
          input({ tabs: [], groups: [group(1, 101)] }),
        );

        expect(plan).toMatchObject({ expand: undefined });
      });

      it.each([
        ['has none', [group(1)]],
        ['has a null one', [group(1, null)]],
        ['has the id 0', [group(1, 0)]],
        ['is not among the groups', [group(2, 102)]],
        ['there are no groups', []],
      ])('expands nothing when the active group %s', (_name, groups) => {
        const plan = planVisibility(input({ tabs: [tab(1, 1)], groups }));

        expect(plan).toMatchObject({ expand: undefined });
      });
    });

    describe('the toolbar title', () => {
      it.each([
        [0, true],
        [1, true],
        [7, true],
        [-1, false],
      ])('for active group %s: update it is %s', (activeGroup, update) => {
        const plan = planVisibility(
          input({ activeGroup, tabs: [tab(1, activeGroup)] }),
        );

        expect(plan).toMatchObject({ updateTitle: update });
      });
    });

    it('does not change what it was given', () => {
      const tabs = [tab(1, 1), tab(2, 2)];
      const groups = [group(1, 101)];

      planVisibility(input({ tabs, groups }));

      expect(tabs).toEqual([tab(1, 1), tab(2, 2)]);
      expect(groups).toEqual([group(1, 101)]);
    });
  });
});
