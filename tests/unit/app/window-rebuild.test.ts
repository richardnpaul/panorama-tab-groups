import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createWindowRebuild } from '../../../src/js/app/window-rebuild.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';

const VIEW = 'moz-extension://id/view.html';

const rect = (x: number) => ({ x, y: 0, w: 0.3, h: 0.3 });
const kept = (id: number, name: string): Group => ({
  id,
  name,
  rect: rect(id),
});

const tab = (
  id: number,
  windowId: number,
  overrides: Partial<TabDetails> = {},
): TabDetails => ({
  id,
  windowId,
  active: false,
  pinned: false,
  url: `https://site${String(id)}/`,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
  ...overrides,
});

/** A native group of a restored window, with the tabs in it */
interface Native {
  id: number;
  title: string;
  collapsed?: boolean;
  tabs: number[];
}

/** What was kept of a window that closed */
interface Kept {
  windowId: number;
  groups: Group[];
  active?: number;
  index?: number;
}

async function setUp({
  windowIds = [101],
  natives = {},
  extraTabs = [],
  closed = [],
  enabled = true,
}: {
  windowIds?: number[];
  /** The native groups of each open window, by window */
  natives?: Record<number, Native[]>;
  extraTabs?: TabDetails[];
  closed?: Kept[];
  enabled?: boolean;
} = {}) {
  const groupState = createMemoryGroupState();
  const windows = createMemoryWindows(windowIds[0] ?? 101);
  windowIds.slice(1).forEach((id) => {
    windows.open(id);
  });
  const nativeGroups = createMemoryNativeGroups([], windowIds[0] ?? 101);
  const tabDetails: TabDetails[] = [...extraTabs];
  await Object.entries(natives).reduce(async (done, [windowId, groups]) => {
    await done;
    await groups.reduce(async (inner, native) => {
      await inner;
      nativeGroups.seed(native.id, Number(windowId), native.tabs);
      await nativeGroups.setAppearance(native.id, {
        title: native.title,
        color: undefined,
      });
      await nativeGroups.setCollapsed(native.id, native.collapsed === true);
      native.tabs.forEach((id) => {
        tabDetails.push(
          tab(id, Number(windowId), { browserGroupId: native.id }),
        );
      });
    }, Promise.resolve());
  }, Promise.resolve());
  const tabs = createMemoryTabs();
  tabs.setDetails(tabDetails);
  await Promise.all(
    closed.map(async (entry) => {
      await groupState.setGroups(entry.windowId, entry.groups);
      if (entry.active !== undefined) {
        await groupState.setActiveGroup(entry.windowId, entry.active);
      }
      if (entry.index !== undefined) {
        await groupState.setGroupIndex(entry.windowId, entry.index);
      }
    }),
  );
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const rebuild = createWindowRebuild({
    enabled,
    groupState,
    archive: groupState,
    windows,
    tabs,
    nativeGroups,
    i18n: {
      getMessage: (name) => (name === 'defaultGroupName' ? 'Group ' : ''),
    },
    viewUrl: VIEW,
    logger,
  });
  return { rebuild, groupState, windows, tabs, nativeGroups, logger };
}

type Env = Awaited<ReturnType<typeof setUp>>;

/** The groups of a window as the add-on keeps them, without the group for ungrouped tabs */
const userGroups = async (env: Env, windowId: number) =>
  ((await env.groupState.getGroups(windowId)) ?? []).filter(
    ({ id }) => id >= 0,
  );

const links = async (env: Env, windowId: number) =>
  (await userGroups(env, windowId)).map(({ id, nativeGroupId }) => [
    id,
    nativeGroupId,
  ]);

describe('app/window-rebuild.ts', () => {
  describe('a window that comes back with native groups, and a window that was kept', () => {
    async function oneWindow() {
      return setUp({
        natives: {
          101: [
            { id: 900, title: 'Work', tabs: [1, 2], collapsed: true },
            { id: 901, title: 'Play', tabs: [3] },
          ],
        },
        extraTabs: [tab(4, 101)],
        closed: [
          {
            windowId: 7,
            groups: [kept(4, 'Work'), kept(2, 'Play'), kept(9, 'Empty')],
            active: 4,
            index: 10,
          },
        ],
      });
    }

    it('keeps each group’s id, place, name and order, and brings back a group that had no tabs', async () => {
      const env = await oneWindow();

      await env.rebuild.rebuildAll();

      expect(await userGroups(env, 101)).toMatchObject([
        { id: 4, name: 'Work', rect: rect(4) },
        { id: 2, name: 'Play', rect: rect(2) },
        { id: 9, name: 'Empty', rect: rect(9) },
      ]);
    });

    it('links each group to its native group', async () => {
      const env = await oneWindow();

      await env.rebuild.rebuildAll();

      expect(await links(env, 101)).toEqual([
        [4, 900],
        [2, 901],
        [9, undefined],
      ]);
    });

    it('puts each tab in the group of its native group, and a tab in none in the group for ungrouped tabs', async () => {
      const env = await oneWindow();

      await env.rebuild.rebuildAll();

      expect(
        await Promise.all(
          [1, 2, 3, 4].map((id) => env.groupState.getTabGroup(id)),
        ),
      ).toEqual([4, 4, 2, -2]);
    });

    it('shows the group whose native group is the one that is open', async () => {
      const env = await oneWindow();

      await env.rebuild.rebuildAll();

      expect(await env.groupState.getActiveGroup(101)).toBe(2);
    });

    it('goes on from the number the window had, and forgets the window it took the groups from', async () => {
      const env = await oneWindow();

      await env.rebuild.rebuildAll();

      expect(await env.groupState.getGroupIndex(101)).toBe(10);
      expect(await env.groupState.listStoredWindowIds()).toEqual([101]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Rebuild] Window 101: 2 native groups, groups of window 7 kept',
      );
    });

    it('gives a private window groups of its own from its native groups, never those of a window that was kept', async () => {
      const env = await oneWindow();
      env.windows.makePrivate(101);

      await env.rebuild.rebuildAll();

      expect(await userGroups(env, 101)).toMatchObject([
        { id: 0, name: 'Work' },
        { id: 1, name: 'Play' },
      ]);
      expect(
        (await env.groupState.getGroups(7))?.map(({ name }) => name),
      ).toEqual(['Work', 'Play', 'Empty']);
    });

    it('gives the window that was kept to a window that is not private, though a private one fits it too', async () => {
      const env = await setUp({
        windowIds: [101, 102],
        natives: {
          101: [{ id: 900, title: 'Work', tabs: [1] }],
          102: [{ id: 901, title: 'Work', tabs: [2] }],
        },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });
      env.windows.makePrivate(101);

      await env.rebuild.rebuildAll();

      expect(await links(env, 102)).toEqual([[4, 901]]);
      expect(await links(env, 101)).toEqual([[0, 900]]);
    });

    it('goes on from after the highest group when the window had no number', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });

      await env.rebuild.rebuildAll();

      expect(await env.groupState.getGroupIndex(101)).toBe(5);
    });

    it('is the same for one window that opens as for all at start', async () => {
      const env = await oneWindow();

      await expect(env.rebuild.rebuildWindow(101)).resolves.toBe(true);

      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([
        4, 2, 9,
      ]);
    });
  });

  describe('the group that is shown', () => {
    const natives = (collapsed: boolean[]): Native[] =>
      collapsed.map((isCollapsed, at) => ({
        id: 900 + at,
        title: at === 0 ? 'Work' : 'Play',
        collapsed: isCollapsed,
        tabs: [at + 1],
      }));
    const closed = (active?: number): Kept[] => [
      {
        windowId: 7,
        groups: [kept(4, 'Work'), kept(2, 'Play')],
        ...(active === undefined ? {} : { active }),
      },
    ];

    it('is the one that was shown when none or both of the native groups are open', async () => {
      const bothOpen = await setUp({
        natives: { 101: natives([false, false]) },
        closed: closed(4),
      });
      const noneOpen = await setUp({
        natives: { 101: natives([true, true]) },
        closed: closed(4),
      });

      await bothOpen.rebuild.rebuildAll();
      await noneOpen.rebuild.rebuildAll();

      // Not the lowest group, which is 2
      expect(await bothOpen.groupState.getActiveGroup(101)).toBe(4);
      expect(await noneOpen.groupState.getActiveGroup(101)).toBe(4);
    });

    it('is the one that was shown, not the first native group, when both are open', async () => {
      const env = await setUp({
        natives: { 101: natives([false, false]) },
        closed: closed(2),
      });

      await env.rebuild.rebuildAll();

      // The first native group is Work, group 4
      expect(await env.groupState.getActiveGroup(101)).toBe(2);
    });

    it('is the lowest group when the one that was shown is not among them', async () => {
      const env = await setUp({
        natives: { 101: natives([true, true]) },
        closed: closed(77),
      });

      await env.rebuild.rebuildAll();

      expect(await env.groupState.getActiveGroup(101)).toBe(2);
    });

    it('is the lowest group when no window was kept and none of the native groups is the only one open', async () => {
      const env = await setUp({ natives: { 101: natives([true, true]) } });

      await env.rebuild.rebuildAll();

      expect(await env.groupState.getActiveGroup(101)).toBe(0);
    });
  });

  describe('the native groups alone', () => {
    it('are given groups of their own, named by their title and numbered from 0, when no window was kept', async () => {
      const env = await setUp({
        natives: {
          101: [
            { id: 900, title: 'Work', tabs: [1] },
            { id: 901, title: '', tabs: [2] },
          ],
        },
      });

      await env.rebuild.rebuildAll();

      expect(await userGroups(env, 101)).toMatchObject([
        { id: 0, name: 'Work', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
        { id: 1, name: 'Group 1' },
      ]);
      expect(await links(env, 101)).toEqual([
        [0, 900],
        [1, 901],
      ]);
      expect(await env.groupState.getGroupIndex(101)).toBe(2);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Rebuild] Window 101: 2 native groups, no window kept to go with them',
      );
    });

    it('go on from the number the window has', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
      });
      await env.groupState.setGroupIndex(101, 6);

      await env.rebuild.rebuildAll();

      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([6]);
    });

    it('are used when a title is one no kept group has, as the window kept is not one of theirs', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Elsewhere', tabs: [1] }] },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });

      await env.rebuild.rebuildAll();

      expect((await userGroups(env, 101)).map(({ name }) => name)).toEqual([
        'Elsewhere',
      ]);
      // and what was kept is left for another window
      expect(await env.groupState.listStoredWindowIds()).toEqual([7, 101]);
    });

    it('are given a group of their own when two kept groups have the title, which cannot tell them apart', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Same', tabs: [1] }] },
        closed: [
          { windowId: 7, groups: [kept(4, 'Same'), kept(5, 'Same')], index: 6 },
        ],
      });

      await env.rebuild.rebuildAll();

      // Both kept groups come back empty, and the native group has one made for it
      expect(await links(env, 101)).toEqual([
        [4, undefined],
        [5, undefined],
        [6, 900],
      ]);
    });

    it('give a group to the first of two native groups with one title, and one of its own to the other', async () => {
      const env = await setUp({
        natives: {
          101: [
            { id: 900, title: 'Work', tabs: [1] },
            { id: 901, title: 'Work', tabs: [2] },
          ],
        },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')], index: 5 }],
      });

      await env.rebuild.rebuildAll();

      expect(await links(env, 101)).toEqual([
        [4, 900],
        [5, 901],
      ]);
    });
  });

  describe('which window that was kept goes with which window', () => {
    // Two windows with groups named by default have the same titles
    const two = (index: number, active: number): Kept => ({
      windowId: index,
      groups: [kept(0, 'Group 0'), kept(1, 'Group 1')],
      active,
    });

    it('pairs the windows one to one, so that the two that fit both get one each', async () => {
      const env = await setUp({
        windowIds: [101, 102],
        natives: {
          101: [
            { id: 900, title: 'Group 0', tabs: [1] },
            { id: 901, title: 'Group 1', tabs: [2] },
          ],
          102: [
            { id: 902, title: 'Group 0', tabs: [3] },
            { id: 903, title: 'Group 1', tabs: [4] },
          ],
        },
        closed: [two(7, 0), two(8, 1)],
      });

      await env.rebuild.rebuildAll();

      // A tie goes in the order of the ids of the windows
      expect(await env.groupState.listStoredWindowIds()).toEqual([101, 102]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Rebuild] Window 101: 2 native groups, groups of window 7 kept',
      );
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Rebuild] Window 102: 2 native groups, groups of window 8 kept',
      );
    });

    it('prefers the window whose names are exactly the titles to one that has more', async () => {
      const env = await setUp({
        natives: {
          101: [
            { id: 900, title: 'Work', tabs: [1] },
            { id: 901, title: 'Play', tabs: [2] },
          ],
        },
        closed: [
          {
            windowId: 6,
            groups: [kept(1, 'Work'), kept(2, 'Play'), kept(3, 'More')],
          },
          { windowId: 9, groups: [kept(4, 'Work'), kept(5, 'Play')] },
        ],
      });

      await env.rebuild.rebuildAll();

      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([4, 5]);
      expect(await env.groupState.listStoredWindowIds()).toEqual([6, 101]);
    });

    it('prefers the window with fewer groups left over', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: [
          {
            windowId: 6,
            groups: [kept(1, 'Work'), kept(2, 'A'), kept(3, 'B')],
          },
          { windowId: 9, groups: [kept(4, 'Work'), kept(5, 'A')] },
        ],
      });

      await env.rebuild.rebuildAll();

      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([4, 5]);
    });

    it('prefers the window whose shown group is the one that is open, when the rest is equal', async () => {
      const env = await setUp({
        natives: {
          101: [
            { id: 900, title: 'Group 0', tabs: [1], collapsed: true },
            { id: 901, title: 'Group 1', tabs: [2] },
          ],
        },
        closed: [two(6, 0), two(9, 1)],
      });

      await env.rebuild.rebuildAll();

      // Window 9 showed Group 1, which is open here, though window 6 comes first
      expect(await env.groupState.listStoredWindowIds()).toEqual([6, 101]);
    });

    it('does not take the shown group for a match when more than one native group is open', async () => {
      const env = await setUp({
        natives: {
          101: [
            { id: 900, title: 'Group 0', tabs: [1] },
            { id: 901, title: 'Group 1', tabs: [2] },
          ],
        },
        closed: [two(6, 1), two(9, 0)],
      });

      await env.rebuild.rebuildAll();

      // Window 9 showed the group of the first native group, which is no match with both open: the
      // lower id of the two windows goes with it
      expect(await env.groupState.listStoredWindowIds()).toEqual([9, 101]);
    });

    it('goes in the order of the ids when the windows fit alike, whatever the number of them', async () => {
      const entries = (ids: number[]): Kept[] =>
        ids.map((windowId) => ({
          windowId,
          groups: [kept(5, 'Work')],
        }));
      const one = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: entries([12, 6, 9]),
      });
      const twoWindows = await setUp({
        // The window with the higher id is the first in the list
        windowIds: [102, 101],
        natives: {
          101: [{ id: 900, title: 'Work', tabs: [1] }],
          102: [{ id: 901, title: 'Work', tabs: [2] }],
        },
        closed: entries([12]),
      });

      await one.rebuild.rebuildAll();
      await twoWindows.rebuild.rebuildAll();

      // Of three, the lowest; and of two windows for one, the window with the lower id
      expect(
        (await one.groupState.listStoredWindowIds()).sort((a, b) => a - b),
      ).toEqual([9, 12, 101]);
      // The entry (its group has the id 5) goes to the window with the lower id
      expect(await userGroups(twoWindows, 101)).toMatchObject([
        { id: 5, name: 'Work' },
      ]);
      expect(await userGroups(twoWindows, 102)).toMatchObject([
        { id: 0, name: 'Work' },
      ]);
    });

    it('gives the entry to the window it fits best, though another window fits it too', async () => {
      const env = await setUp({
        windowIds: [101, 102],
        natives: {
          101: [{ id: 900, title: 'Work', tabs: [1] }],
          102: [
            { id: 901, title: 'Work', tabs: [2] },
            { id: 902, title: 'Play', tabs: [3] },
          ],
        },
        closed: [{ windowId: 7, groups: [kept(4, 'Work'), kept(5, 'Play')] }],
      });

      await env.rebuild.rebuildAll();

      // Window 102 has both titles, so it has the groups; window 101 has its native group alone
      expect((await userGroups(env, 102)).map(({ id }) => id)).toEqual([4, 5]);
      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([0]);
    });

    it('is no fit when one title of a native group is not a name that was kept, though another is', async () => {
      const env = await setUp({
        natives: {
          101: [
            { id: 900, title: 'Work', tabs: [1] },
            { id: 901, title: 'Elsewhere', tabs: [2] },
          ],
        },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });

      await env.rebuild.rebuildAll();

      // The native groups alone, and the entry is still there
      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([0, 1]);
      expect(
        (await env.groupState.listStoredWindowIds()).sort((a, b) => a - b),
      ).toEqual([7, 101]);
    });

    it('does not count the group for ungrouped tabs among the names of a window that was kept', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: [
          {
            windowId: 9,
            groups: [kept(4, 'Work'), { ...kept(-2, 'Ungrouped Tabs') }],
          },
          { windowId: 6, groups: [kept(5, 'Work'), kept(6, 'More')] },
        ],
      });

      await env.rebuild.rebuildAll();

      // Window 9 has the title and nothing else of the user's: the better fit, though 6 has the lower id
      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([4]);
    });

    it('leaves a window with nothing that fits to its native groups alone, and the entry that was kept', async () => {
      const env = await setUp({
        windowIds: [101, 102],
        natives: {
          101: [{ id: 900, title: 'Work', tabs: [1] }],
          102: [{ id: 901, title: 'Work', tabs: [2] }],
        },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });

      await env.rebuild.rebuildAll();

      // Only one window can have the kept groups: the other has its native groups alone
      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([4]);
      expect((await userGroups(env, 102)).map(({ id }) => id)).toEqual([0]);
    });
  });

  describe('groups and native groups with no name or title', () => {
    it('matches a native group to a kept group that has no name by the name the add-on gave the native group', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Group 4', tabs: [1] }] },
        closed: [{ windowId: 7, groups: [kept(4, '')] }],
      });

      await env.rebuild.rebuildAll();

      expect(await links(env, 101)).toEqual([[4, 900]]);
    });

    it('gives a native group that has no title a group named by its number', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: '', tabs: [1] }] },
      });
      vi.spyOn(env.nativeGroups, 'get').mockResolvedValue({
        windowId: 101,
        title: undefined,
        collapsed: false,
      });

      await env.rebuild.rebuildAll();

      expect((await userGroups(env, 101)).map(({ name }) => name)).toEqual([
        'Group 0',
      ]);
    });

    it('leaves a window that was kept with values but no groups', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
      });
      await env.groupState.setGroupIndex(7, 3);

      await env.rebuild.rebuildAll();

      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([0]);
      expect(
        (await env.groupState.listStoredWindowIds()).sort(
          (first, second) => first - second,
        ),
      ).toEqual([7, 101]);
    });
  });

  describe('the tabs', () => {
    it('gives a pinned tab no group, and the view its own', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        extraTabs: [
          tab(2, 101, { pinned: true }),
          tab(3, 101, { url: VIEW }),
          tab(4, 101, { url: undefined, pendingUrl: VIEW }),
        ],
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });
      await env.groupState.setTabGroup(2, 4);

      await env.rebuild.rebuildAll();

      expect(
        await Promise.all(
          [1, 2, 3, 4].map((id) => env.groupState.getTabGroup(id)),
        ),
      ).toEqual([4, undefined, -1, -1]);
    });
  });

  describe('where there is nothing to rebuild', () => {
    it('does nothing in a browser that keeps its values with the window', async () => {
      const env = await setUp({
        enabled: false,
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });

      await env.rebuild.rebuildAll();
      await expect(env.rebuild.rebuildWindow(101)).resolves.toBe(false);

      expect(await env.groupState.getGroups(101)).toBeUndefined();
      expect(await env.groupState.listStoredWindowIds()).toEqual([7]);
    });

    it('reads nothing of what was kept when no window needs it', async () => {
      const env = await setUp({
        extraTabs: [tab(1, 101)],
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });
      const read = vi.spyOn(env.groupState, 'getGroups');

      await env.rebuild.rebuildAll();

      // Only the window itself was looked at
      expect(read.mock.calls).toEqual([[101]]);
    });

    it('leaves a window that has groups of the add-on’s', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });
      await env.groupState.setGroups(101, [kept(0, 'Mine')]);

      await expect(env.rebuild.rebuildWindow(101)).resolves.toBe(false);

      expect((await userGroups(env, 101)).map(({ name }) => name)).toEqual([
        'Mine',
      ]);
    });

    it('does not count the group for ungrouped tabs as a group of the add-on’s', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });
      await env.groupState.setGroups(101, [kept(-2, 'Ungrouped Tabs')]);

      await expect(env.rebuild.rebuildWindow(101)).resolves.toBe(true);
    });

    it('leaves a window that has no native groups', async () => {
      const env = await setUp({
        extraTabs: [tab(1, 101)],
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });

      await expect(env.rebuild.rebuildWindow(101)).resolves.toBe(false);
      await env.rebuild.rebuildAll();

      expect(await env.groupState.getGroups(101)).toBeUndefined();
      expect(await env.groupState.listStoredWindowIds()).toEqual([7]);
    });

    it('does not take the groups of a window that is open, or that kept none of the user’s', async () => {
      const env = await setUp({
        windowIds: [101, 102],
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
      });
      await env.groupState.setGroups(102, [kept(4, 'Work')]);
      await env.groupState.setGroups(7, [kept(-2, 'Ungrouped Tabs')]);

      await env.rebuild.rebuildAll();

      // Window 102 is open, and window 7 has no group of the user's to give
      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([0]);
      expect((await userGroups(env, 102)).map(({ id }) => id)).toEqual([4]);
    });

    it('goes on with the other windows when one cannot be rebuilt, says so, and keeps what was kept', async () => {
      const env = await setUp({
        windowIds: [101, 102],
        natives: {
          101: [{ id: 900, title: 'Work', tabs: [1] }],
          102: [{ id: 901, title: 'Play', tabs: [2] }],
        },
        closed: [
          { windowId: 7, groups: [kept(4, 'Work')] },
          { windowId: 8, groups: [kept(5, 'Play')] },
        ],
      });
      const failure = new Error('Invalid window ID: 101');
      const list = env.tabs.listInWindow.bind(env.tabs);
      vi.spyOn(env.tabs, 'listInWindow').mockImplementation((windowId) =>
        windowId === 101 ? Promise.reject(failure) : list(windowId),
      );

      await env.rebuild.rebuildAll();

      // The first has no group of the user's, and what was kept for it is there to try again
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Rebuild] Window 101 could not be rebuilt:',
        failure,
      );
      // and it has nothing stored at all, so no half of a rebuild is left
      expect(await env.groupState.listStoredWindowIds()).not.toContain(101);
      expect(await userGroups(env, 102)).toMatchObject([{ id: 5 }]);
      expect(
        (await env.groupState.listStoredWindowIds()).sort((a, b) => a - b),
      ).toEqual([7, 102]);
    });

    it('says a window is not rebuilt when it failed before it had groups, so it gets a first group of its own', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });
      vi.spyOn(env.tabs, 'listInWindow').mockRejectedValue(new Error('gone'));

      await expect(env.rebuild.rebuildWindow(101)).resolves.toBe(false);
    });

    it('says a window is rebuilt when it failed after it had groups, which a first group of its own must not cover', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
        closed: [{ windowId: 7, groups: [kept(4, 'Work')] }],
      });
      vi.spyOn(env.groupState, 'setNativeGroupLink').mockRejectedValue(
        new Error('storage'),
      );

      await expect(env.rebuild.rebuildWindow(101)).resolves.toBe(true);

      expect((await userGroups(env, 101)).map(({ id }) => id)).toEqual([4]);
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Rebuild] Window 101 could not be rebuilt:',
        new Error('storage'),
      );
    });

    it('says so, and goes on, when a native group cannot be read', async () => {
      const env = await setUp({
        natives: { 101: [{ id: 900, title: 'Work', tabs: [1] }] },
      });
      const failure = new Error('No window');
      vi.spyOn(env.nativeGroups, 'listIdsInWindow').mockRejectedValue(failure);

      await env.rebuild.rebuildAll();
      await expect(env.rebuild.rebuildWindow(101)).resolves.toBe(false);

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Rebuild] The groups could not be rebuilt:',
        failure,
      );
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Rebuild] The groups of window 101 could not be rebuilt:',
        failure,
      );
    });
  });
});
