import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createBrowserEvents } from '../../../src/js/app/browser-events.js';
import { createViewOpening } from '../../../src/js/app/view-opening.js';

const VIEW = 'moz-extension://id/view.html';

function setUp({ useNative = true }: { useNative?: boolean } = {}) {
  const groupState = createMemoryGroupState();
  const nativeGroups = createMemoryNativeGroups([50], 1);
  nativeGroups.seed(50, 1, [10]);
  const tabs = createMemoryTabs();
  const cleanup = vi.fn().mockResolvedValue(undefined);
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const viewOpening = createViewOpening({
    clock: createMemoryClock(0),
    scheduler: createMemoryScheduler(),
    logger,
  });
  return {
    events: createBrowserEvents({
      groupState,
      nativeGroups,
      tabs,
      nativeGroupsSync: { cleanup },
      viewOpening,
      useNativeGroups: () => Promise.resolve(useNative),
      viewUrl: VIEW,
      version: '2.5.0',
      logger,
    }),
    groupState,
    nativeGroups,
    tabs,
    cleanup,
    viewOpening,
    logger,
  };
}

describe('app/browser-events.ts', () => {
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
        'Tab 10 updated to panorama view, assigned groupId -1',
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

  describe('onInstalled', () => {
    it('opens the release notes of the version after an update', async () => {
      const env = setUp();

      await env.events.onInstalled({ reason: 'update' });

      expect(env.tabs.calls).toEqual([
        'open https://github.com/projectdelphai/panorama-tab-groups/releases/tag/2.5.0',
      ]);
      expect((await env.tabs.get(9000)).active).toBe(true);
    });

    it.each([['install'], ['browser_update'], ['shared_module_update']])(
      'opens nothing after the reason %s',
      async (reason) => {
        const env = setUp();

        await env.events.onInstalled({ reason });

        expect(env.tabs.calls).toEqual([]);
      },
    );

    it('opens nothing for a temporary add-on', async () => {
      const env = setUp();

      await env.events.onInstalled({ reason: 'update', temporary: true });

      expect(env.tabs.calls).toEqual([]);
    });

    it('opens the notes for an add-on that says it is not temporary', async () => {
      const env = setUp();

      await env.events.onInstalled({ reason: 'update', temporary: false });

      expect(env.tabs.calls).toHaveLength(1);
    });
  });

  describe('onStorageChanged', () => {
    it('cleans up when native groups were switched off', async () => {
      const env = setUp();

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
        const env = setUp();

        await env.events.onStorageChanged({ useNativeGroups: change }, area);

        expect(env.cleanup).not.toHaveBeenCalled();
      },
    );

    it('does not clean up for another setting', async () => {
      const env = setUp();

      await env.events.onStorageChanged(
        { theme: { oldValue: true, newValue: false } },
        'sync',
      );

      expect(env.cleanup).not.toHaveBeenCalled();
    });

    it('says so when the clean up fails', async () => {
      const env = setUp();
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
