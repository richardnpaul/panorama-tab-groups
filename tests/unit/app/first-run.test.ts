import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryOptions } from '../../../src/js/adapters/memory/options.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createFirstRun } from '../../../src/js/app/first-run.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';

const tab = (id: number, windowId: number): TabDetails => ({
  id,
  windowId,
  active: false,
  pinned: false,
  url: `https://site${String(id)}/`,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
});

const group = (id: number): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

interface Setup {
  /** The tabs of each window, by window id */
  windows?: Record<number, number>;
  /** The groups stored for each window, by window id */
  groups?: Record<number, Group[]>;
  stored?: Record<string, unknown>;
  hasTabHide?: boolean;
  hasTabGroups?: boolean;
}

async function setUp({
  windows: tabCounts = { 1: 1 },
  groups = {},
  stored = {},
  hasTabHide = true,
  hasTabGroups = true,
}: Setup = {}) {
  const options = createMemoryOptions({ stored });
  const windows = createMemoryWindows(1);
  const tabs = createMemoryTabs();
  const groupState = createMemoryGroupState();
  const windowIds = Object.keys(tabCounts).map(Number);
  windowIds.forEach((id) => {
    windows.open(id);
  });
  tabs.setDetails(
    Object.entries(tabCounts).flatMap(([windowId, count]) =>
      Array.from({ length: count }, (_, index) =>
        tab(Number(windowId) * 100 + index, Number(windowId)),
      ),
    ),
  );
  await Promise.all(
    Object.entries(groups).map(([windowId, inWindow]) =>
      groupState.setGroups(Number(windowId), inWindow),
    ),
  );
  const logger = { debug: vi.fn() };
  const firstRun = createFirstRun({
    options,
    windows,
    tabs,
    groupState,
    capabilities: { hasTabHide, hasTabGroups },
    logger,
  });
  return { firstRun, options, logger };
}

describe('app/first-run.ts', () => {
  describe('in Firefox, where tabs can be hidden and there are native tab groups', () => {
    it('turns native groups on in a browser with one window of one tab: there is nothing to move', async () => {
      const env = await setUp({ windows: { 1: 1 } });

      await env.firstRun.decideNativeGroups();

      expect((await env.options.load()).useNativeGroups).toBe(true);
      expect(env.options.stored.useNativeGroups).toBe(true);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[FirstRun] Nothing to move: native tab groups are on',
      );
    });

    it('turns native groups off where a window has more than one tab, which nothing has grouped', async () => {
      const env = await setUp({ windows: { 1: 1, 2: 2 } });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(false);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[FirstRun] Tabs or groups are in place: native tab groups stay off until the user turns them on',
      );
    });

    it('turns native groups off where groups of an earlier version are stored', async () => {
      const env = await setUp({
        windows: { 1: 1 },
        groups: { 1: [group(0)] },
      });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(false);
    });

    it('looks at every window, not only the first', async () => {
      const env = await setUp({
        windows: { 1: 1, 2: 1, 3: 1 },
        groups: { 3: [group(2)] },
      });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(false);
    });

    it('does not count the group for ungrouped tabs, which is made for every window', async () => {
      const env = await setUp({
        windows: { 1: 1 },
        groups: { 1: [{ ...group(-2), name: 'Ungrouped' }] },
      });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(true);
    });

    it('does not count a window that has no groups stored at all', async () => {
      const env = await setUp({ windows: { 1: 1 }, groups: {} });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(true);
    });

    it.each([true, false])(
      'leaves it as it is when it was chosen (%s), whatever there is to move',
      async (chosen) => {
        const env = await setUp({
          windows: { 1: 4 },
          groups: { 1: [group(0)] },
          stored: { useNativeGroups: chosen },
        });

        await env.firstRun.decideNativeGroups();

        expect(env.options.stored.useNativeGroups).toBe(chosen);
        expect(env.logger.debug).not.toHaveBeenCalled();
      },
    );

    it('decides once: what it decided is kept when there are more tabs the next time', async () => {
      const env = await setUp({ windows: { 1: 1 } });
      await env.firstRun.decideNativeGroups();
      const later = createFirstRun({
        options: env.options,
        windows: createMemoryWindows(1),
        tabs: (() => {
          const tabs = createMemoryTabs();
          tabs.setDetails([tab(1, 1), tab(2, 1), tab(3, 1)]);
          return tabs;
        })(),
        groupState: createMemoryGroupState(),
        capabilities: { hasTabHide: true, hasTabGroups: true },
        logger: { debug: vi.fn() },
      });

      await later.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(true);
    });
  });

  describe('where native groups are not a choice', () => {
    it('does nothing in Chromium, which has native tab groups and cannot hide tabs', async () => {
      const env = await setUp({
        windows: { 1: 5 },
        hasTabHide: false,
        hasTabGroups: true,
      });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored).toEqual({});
    });

    it('does nothing in a Firefox that has no native tab groups', async () => {
      const env = await setUp({
        windows: { 1: 5 },
        hasTabHide: true,
        hasTabGroups: false,
      });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored).toEqual({});
    });

    it('does nothing in a browser that has neither', async () => {
      const env = await setUp({
        hasTabHide: false,
        hasTabGroups: false,
      });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored).toEqual({});
    });
  });
});
