import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import { createBrowserEvents } from '../../../src/js/app/browser-events.js';
import { createOwnMoves } from '../../../src/js/app/own-moves.js';
import { createViewOpening } from '../../../src/js/app/view-opening.js';

const VIEW = 'moz-extension://id/view.html';

function setUp({ useNative = true }: { useNative?: boolean } = {}) {
  const groupState = createMemoryGroupState();
  const nativeGroups = createMemoryNativeGroups([50], 1);
  nativeGroups.seed(50, 1, [10]);
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const viewOpening = createViewOpening({
    clock: createMemoryClock(0),
    scheduler: createMemoryScheduler(),
    logger,
  });
  const waitForInitialization = vi.fn().mockResolvedValue(undefined);
  const tabs = createMemoryTabs();
  const ownMoves = createOwnMoves();
  return {
    tabs,
    ownMoves,
    events: createBrowserEvents({
      groupState,
      nativeGroups,
      nativeGroupsSync: { cleanup },
      viewOpening,
      tabs,
      useNativeGroups: () => Promise.resolve(useNative),
      waitForInitialization,
      ownMoves,
      viewUrl: VIEW,
      logger,
    }),
    waitForInitialization,
    groupState,
    nativeGroups,
    cleanup,
    viewOpening,
    logger,
  };
}

describe('app/browser-events.ts', () => {
  describe('onTabUpdated, for a tab that was pinned or unpinned', () => {
    it('takes the group of a tab that is pinned, after start-up', async () => {
      const env = setUp();
      await env.groupState.setTabGroup(10, 2);

      await env.events.onTabUpdated(10, { pinned: true }, { windowId: 1 });

      expect(await env.groupState.getTabGroup(10)).toBeUndefined();
      expect(env.waitForInitialization).toHaveBeenCalledTimes(1);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Tab 10 pinned, so it has no group',
      );
    });

    it('leaves the view alone when it is pinned: it is the view, not a tab in a group', async () => {
      const env = setUp();
      await env.groupState.setTabGroup(10, -1);

      await env.events.onTabUpdated(10, { pinned: true }, { windowId: 1 });

      expect(await env.groupState.getTabGroup(10)).toBe(-1);
    });

    it('leaves a tab that is unpinned ungrouped in native mode', async () => {
      const env = setUp();

      await env.events.onTabUpdated(10, { pinned: false }, { windowId: 1 });

      expect(await env.groupState.getTabGroup(10)).toBe(-2);
      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('puts a tab that is unpinned in the group the window shows, with tabs hidden', async () => {
      const env = setUp({ useNative: false });
      await env.groupState.setActiveGroup(1, 4);

      await env.events.onTabUpdated(10, { pinned: false }, { windowId: 1 });

      expect(await env.groupState.getTabGroup(10)).toBe(4);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Tab 10 unpinned, so it joins group 4',
      );
    });

    it.each([
      ['has none', undefined],
      ['shows the view', -1],
    ])(
      'puts a tab that is unpinned in the lowest group of a window that %s',
      async (_, active) => {
        const env = setUp({ useNative: false });
        await env.groupState.setGroups(1, [
          { id: 3, name: 'C', rect: { x: 0, y: 0, w: 1, h: 1 } },
          { id: 1, name: 'A', rect: { x: 0, y: 0, w: 1, h: 1 } },
        ]);
        if (active !== undefined) {
          await env.groupState.setActiveGroup(1, active);
        }

        await env.events.onTabUpdated(10, { pinned: false }, { windowId: 1 });

        expect(await env.groupState.getTabGroup(10)).toBe(1);
      },
    );

    it.each([true, false])(
      'keeps the group a tab was given before it was unpinned, as the menu does (native: %s)',
      async (useNative) => {
        const env = setUp({ useNative });
        await env.groupState.setTabGroup(10, 2);

        await env.events.onTabUpdated(10, { pinned: false }, { windowId: 1 });

        expect(await env.groupState.getTabGroup(10)).toBe(2);
      },
    );

    it('gives a tab that is unpinned no group when it is not known which window it is in, with tabs hidden', async () => {
      const env = setUp({ useNative: false });

      await env.events.onTabUpdated(10, { pinned: false }, {});

      expect(await env.groupState.getTabGroup(10)).toBeUndefined();
    });

    it('does not look at the address of a tab whose pinning changed', async () => {
      const env = setUp();

      await env.events.onTabUpdated(
        10,
        { pinned: true },
        { url: VIEW, windowId: 1 },
      );

      expect(await env.groupState.getTabGroup(10)).toBeUndefined();
    });
  });

  describe('onTabUpdated, for a tab that moved between native groups', () => {
    const rect = { x: 0, y: 0, w: 1, h: 1 };
    const details = (browserGroupId: number | undefined, pinned = false) => ({
      id: 10,
      windowId: 1,
      active: false,
      pinned,
      url: undefined,
      pendingUrl: undefined,
      title: undefined,
      browserGroupId,
    });

    async function arranged(
      browserGroupId: number | undefined,
      useNative = true,
    ) {
      const env = setUp({ useNative });
      await env.groupState.setGroups(1, [
        { id: 1, name: 'A', rect },
        { id: 2, name: 'B', rect },
      ]);
      await env.groupState.setNativeGroupLink(1, 1, 50);
      await env.groupState.setNativeGroupLink(1, 2, 60);
      await env.groupState.setTabGroup(10, 1);
      env.tabs.setDetails([details(browserGroupId)]);
      return env;
    }

    const change = { groupId: 60 };
    const tab = { windowId: 1 };

    it('is in the group that goes with the native group it joined', async () => {
      const env = await arranged(60);

      await env.events.onTabUpdated(10, change, tab);

      expect(await env.groupState.getTabGroup(10)).toBe(2);
      expect(env.waitForInitialization).toHaveBeenCalledTimes(1);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Tab 10 joined native group 60, so group 2',
      );
    });

    it('is left as it is when it joined the group it was in', async () => {
      const env = await arranged(50);
      const setTabGroup = vi.spyOn(env.groupState, 'setTabGroup');

      await env.events.onTabUpdated(10, { groupId: 50 }, tab);

      expect(setTabGroup).not.toHaveBeenCalled();
    });

    it('is left as it is when it joined a native group that no group is linked to', async () => {
      const env = await arranged(77);

      await env.events.onTabUpdated(10, { groupId: 77 }, tab);

      expect(await env.groupState.getTabGroup(10)).toBe(1);
    });

    it('is in no group of the user’s when it left its native group', async () => {
      const env = await arranged(-1);

      await env.events.onTabUpdated(10, { groupId: -1 }, tab);

      expect(await env.groupState.getTabGroup(10)).toBe(-2);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Tab 10 left its native group, so it has no group',
      );
    });

    it.each([[undefined], [-1]])(
      'takes the native group it is in now, not the one the report says (%s)',
      async (now) => {
        // The add-on moved it again since, and the report is late
        const env = await arranged(now);

        await env.events.onTabUpdated(10, { groupId: 60 }, tab);

        expect(await env.groupState.getTabGroup(10)).toBe(-2);
      },
    );

    it('does nothing for a tab that has no group, or is in the group for ungrouped tabs, when it left one', async () => {
      const env = await arranged(-1);
      await env.groupState.clearTabGroup(10);

      await env.events.onTabUpdated(10, { groupId: -1 }, tab);
      expect(await env.groupState.getTabGroup(10)).toBeUndefined();

      await env.groupState.setTabGroup(10, -2);
      const setTabGroup = vi.spyOn(env.groupState, 'setTabGroup');
      await env.events.onTabUpdated(10, { groupId: -1 }, tab);
      expect(setTabGroup).not.toHaveBeenCalled();
    });

    it('leaves the view in its place', async () => {
      const env = await arranged(60);
      await env.groupState.setTabGroup(10, -1);

      await env.events.onTabUpdated(10, change, tab);

      expect(await env.groupState.getTabGroup(10)).toBe(-1);
    });

    it('leaves a tab alone that the add-on is moving', async () => {
      const env = await arranged(-1);

      await env.ownMoves.during([10], () =>
        env.events.onTabUpdated(10, { groupId: -1 }, tab),
      );

      expect(await env.groupState.getTabGroup(10)).toBe(1);
    });

    it('leaves a pinned tab alone', async () => {
      const env = await arranged(60);

      await env.events.onTabUpdated(10, change, { windowId: 1, pinned: true });

      expect(await env.groupState.getTabGroup(10)).toBe(1);
    });

    it('does nothing when it is not known which window the tab is in', async () => {
      const env = await arranged(60);

      await env.events.onTabUpdated(10, change, {});

      expect(await env.groupState.getTabGroup(10)).toBe(1);
    });

    it('does nothing with native groups off, where a tab is in a group of the add-on’s alone', async () => {
      const env = await arranged(60, false);

      await env.events.onTabUpdated(10, change, tab);

      expect(await env.groupState.getTabGroup(10)).toBe(1);
    });

    it('does nothing for a tab that is closed already, which is no failure', async () => {
      const env = await arranged(60);
      env.tabs.setDetails([]);

      await expect(
        env.events.onTabUpdated(10, change, tab),
      ).resolves.toBeUndefined();

      expect(await env.groupState.getTabGroup(10)).toBe(1);
      expect(env.logger.error).not.toHaveBeenCalled();
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Tab 10 could not be looked at, so its group is left as it is:',
        expect.any(Error),
      );
    });

    it('passes on a failure to store the group, for the caller to log', async () => {
      const env = await arranged(60);
      const failure = new Error('quota');
      vi.spyOn(env.groupState, 'setTabGroup').mockRejectedValue(failure);

      await expect(env.events.onTabUpdated(10, change, tab)).rejects.toBe(
        failure,
      );
    });

    it('takes a native group with the id 0 for none', async () => {
      const env = await arranged(0);

      await env.events.onTabUpdated(10, { groupId: 0 }, tab);

      expect(await env.groupState.getTabGroup(10)).toBe(-2);
    });

    it('does nothing for a window whose groups were never stored', async () => {
      const env = setUp();
      env.tabs.setDetails([details(60)]);
      await env.groupState.setTabGroup(10, 1);

      await env.events.onTabUpdated(10, change, tab);

      expect(await env.groupState.getTabGroup(10)).toBe(1);
    });
  });

  describe('onTabUpdated', () => {
    it.each([
      ['the change has its address', { url: VIEW }, {}],
      ['the tab has its address', {}, { url: VIEW }],
      ['the tab is about to have its address', {}, { pendingUrl: VIEW }],
    ])('makes the tab the view when %s', async (_name, change, tab) => {
      const env = setUp();
      await env.groupState.setTabGroup(10, 2);

      await env.events.onTabUpdated(10, change, tab);

      expect(await env.groupState.getTabGroup(10)).toBe(-1);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Tab 10 updated to view, assigned groupId -1',
      );
    });

    it('takes the view out of its native group', async () => {
      const env = setUp();

      await env.events.onTabUpdated(10, { url: VIEW }, {});

      expect(await env.nativeGroups.tabIdsIn(50)).toEqual([]);
    });

    it('leaves native groups alone when they are switched off', async () => {
      const env = setUp({ useNative: false });

      await env.events.onTabUpdated(10, { url: VIEW }, {});

      expect(env.nativeGroups.calls).toEqual([]);
    });

    it('carries on when the tab cannot be taken out of its native group', async () => {
      const env = setUp();
      env.nativeGroups.removeTabs = () => Promise.reject(new Error('gone'));

      await env.events.onTabUpdated(10, { url: VIEW }, {});

      expect(await env.groupState.getTabGroup(10)).toBe(-1);
    });

    it('does nothing for a tab that already is the view', async () => {
      const env = setUp();
      await env.groupState.setTabGroup(10, -1);

      await env.events.onTabUpdated(10, { url: VIEW }, {});

      expect(env.nativeGroups.calls).toEqual([]);
      expect(env.logger.debug).not.toHaveBeenCalled();
    });

    it('does nothing for a tab that is not the view', async () => {
      const env = setUp();
      await env.groupState.setTabGroup(10, 2);

      await env.events.onTabUpdated(
        10,
        { url: 'https://example.com/' },
        { url: 'https://example.com/', pendingUrl: undefined },
      );
      await env.events.onTabUpdated(10, {}, {});

      expect(await env.groupState.getTabGroup(10)).toBe(2);
      expect(env.nativeGroups.calls).toEqual([]);
    });
  });

  describe('onTabRemoved', () => {
    it('ends the wait for the view when that tab was closed', () => {
      const env = setUp();
      env.viewOpening.begin(1).opened(10);

      env.events.onTabRemoved(10);

      expect(env.viewOpening.current()).toBeNull();
    });

    it('keeps waiting when another tab was closed', () => {
      const env = setUp();
      env.viewOpening.begin(1).opened(10);

      env.events.onTabRemoved(11);

      expect(env.viewOpening.current()).not.toBeNull();
    });
  });

  describe('onStorageChanged', () => {
    it('cleans up when native groups were switched off', async () => {
      // As the setting that was just stored is read: off
      const env = setUp({ useNative: false });

      await env.events.onStorageChanged(
        { useNativeGroups: { oldValue: true, newValue: false } },
        'sync',
      );

      expect(env.cleanup).toHaveBeenCalledTimes(1);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Storage] Native groups disabled, starting cleanup...',
      );
    });

    it.each([
      ['switched on', { oldValue: false, newValue: true }, 'sync'],
      ['unchanged', { oldValue: true, newValue: true }, 'sync'],
      ['set for the first time to off', { newValue: false }, 'sync'],
      ['set to something else', { oldValue: true, newValue: 0 }, 'sync'],
      [
        'switched off, but in another area',
        { oldValue: true, newValue: false },
        'local',
      ],
    ])(
      'does not clean up when native groups were %s',
      async (_name, change, area) => {
        // Off, as the setting is read after a change: only the change itself says not to clean up
        const env = setUp({ useNative: false });

        await env.events.onStorageChanged({ useNativeGroups: change }, area);

        expect(env.cleanup).not.toHaveBeenCalled();
      },
    );

    it('does not clean up for another setting', async () => {
      const env = setUp({ useNative: false });

      await env.events.onStorageChanged(
        { theme: { oldValue: true, newValue: false } },
        'sync',
      );

      expect(env.cleanup).not.toHaveBeenCalled();
    });

    it('takes nothing apart where native groups are the only kind, whatever a setting changed on another device says', async () => {
      const env = setUp({ useNative: true });

      await env.events.onStorageChanged(
        { useNativeGroups: { oldValue: true, newValue: false } },
        'sync',
      );

      expect(env.cleanup).not.toHaveBeenCalled();
    });

    it('says so when the clean up fails', async () => {
      const env = setUp({ useNative: false });
      const failure = new Error('storage');
      env.cleanup.mockRejectedValue(failure);

      await env.events.onStorageChanged(
        { useNativeGroups: { oldValue: true, newValue: false } },
        'sync',
      );

      expect(env.logger.error).toHaveBeenCalledWith(
        '[Storage] Cleanup failed:',
        failure,
      );
    });
  });
});
