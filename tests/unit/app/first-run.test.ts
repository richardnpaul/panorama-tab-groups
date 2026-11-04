import { describe, expect, it, vi } from 'vitest';
import { createMemoryExtension } from '../../../src/js/adapters/memory/extension.js';
import { createMemoryNotifications } from '../../../src/js/adapters/memory/notifications.js';
import { createMemoryOptions } from '../../../src/js/adapters/memory/options.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createFirstRun } from '../../../src/js/app/first-run.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';
import { englishMessage } from '../../support/messages.js';

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

interface Setup {
  /** The tabs of each window, by window id */
  windows?: Record<number, number>;
  /** How many of the tabs of each window are hidden, by window id */
  hidden?: Record<number, number>;
  stored?: Record<string, unknown>;
  hasTabHide?: boolean;
  hasTabGroups?: boolean;
}

async function setUp({
  windows: tabCounts = { 1: 1 },
  hidden = {},
  stored = {},
  hasTabHide = true,
  hasTabGroups = true,
}: Setup = {}) {
  const options = createMemoryOptions({ stored });
  const windows = createMemoryWindows(1);
  const tabs = createMemoryTabs();
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
  await tabs.hide(
    Object.entries(hidden).flatMap(([windowId, count]) =>
      Array.from(
        { length: count },
        (_, index) => Number(windowId) * 100 + index,
      ),
    ),
  );
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const notifications = createMemoryNotifications();
  const extension = createMemoryExtension();
  const firstRun = createFirstRun({
    options,
    windows,
    tabs,
    capabilities: { hasTabHide, hasTabGroups },
    notifications,
    extension,
    i18n: { getMessage: englishMessage },
    logger,
  });
  return { firstRun, options, logger, notifications, extension };
}

describe('app/first-run.ts', () => {
  describe('in Firefox, where tabs can be hidden and there are native tab groups', () => {
    it('turns native groups on where no tab is hidden, however many tabs there are', async () => {
      const env = await setUp({ windows: { 1: 1, 2: 4 } });

      await env.firstRun.decideNativeGroups();

      expect((await env.options.load()).useNativeGroups).toBe(true);
      expect(env.options.stored.useNativeGroups).toBe(true);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[FirstRun] No tab is hidden: native tab groups are on',
      );
    });

    it('turns native groups off where a window has hidden tabs, which are groups that hide them', async () => {
      const env = await setUp({ windows: { 1: 3 }, hidden: { 1: 2 } });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(false);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[FirstRun] Tabs are hidden in groups: native tab groups stay off until the user turns them on',
      );
    });

    it('looks at every window, not only the first', async () => {
      const env = await setUp({
        windows: { 1: 1, 2: 1, 3: 2 },
        hidden: { 3: 1 },
      });

      await env.firstRun.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(false);
    });

    it.each([true, false])(
      'leaves it as it is when it was chosen (%s), whatever there is to move',
      async (chosen) => {
        const env = await setUp({
          windows: { 1: 4 },
          hidden: { 1: 2 },
          stored: { useNativeGroups: chosen },
        });

        await env.firstRun.decideNativeGroups();

        expect(env.options.stored.useNativeGroups).toBe(chosen);
        expect(env.logger.debug).not.toHaveBeenCalled();
      },
    );

    it('decides once: what it decided is kept when tabs are hidden the next time', async () => {
      const env = await setUp({ windows: { 1: 1 } });
      await env.firstRun.decideNativeGroups();
      const later = createFirstRun({
        options: env.options,
        windows: createMemoryWindows(1),
        tabs: (() => {
          const tabs = createMemoryTabs();
          tabs.setDetails([tab(1, 1), tab(2, 1), tab(3, 1)]);
          tabs.hiddenIds.add(2);
          return tabs;
        })(),
        capabilities: { hasTabHide: true, hasTabGroups: true },
        notifications: createMemoryNotifications(),
        extension: createMemoryExtension(),
        i18n: { getMessage: englishMessage },
        logger: { debug: vi.fn(), warn: vi.fn() },
      });

      await later.decideNativeGroups();

      expect(env.options.stored.useNativeGroups).toBe(true);
    });
  });

  describe('the notice that tabs were left as they are', () => {
    const notice = 'first-run-native-groups-off';

    it('is shown once, when native groups are left off over hidden tabs', async () => {
      const env = await setUp({ windows: { 1: 4 }, hidden: { 1: 2 } });

      await env.firstRun.decideNativeGroups();
      await env.firstRun.decideNativeGroups();

      expect(env.notifications.shown.get(notice)).toEqual({
        title: 'Tab Groups Viewer',
        message: englishMessage('firstRunNativeGroupsOff'),
        iconUrl: 'moz-extension://id/icons/logo/logo-128.png',
      });
      expect(env.notifications.shown.size).toBe(1);
    });

    it('is not shown when there was nothing to keep, and native groups went on', async () => {
      const env = await setUp({ windows: { 1: 1 } });

      await env.firstRun.decideNativeGroups();

      expect(env.notifications.shown.size).toBe(0);
    });

    it('is not shown where native groups are not a choice', async () => {
      const env = await setUp({ windows: { 1: 5 }, hasTabHide: false });

      await env.firstRun.decideNativeGroups();

      expect(env.notifications.shown.size).toBe(0);
    });

    it('is not shown again once the choice has been made', async () => {
      const env = await setUp({
        windows: { 1: 5 },
        stored: { useNativeGroups: false },
      });

      await env.firstRun.decideNativeGroups();

      expect(env.notifications.shown.size).toBe(0);
    });

    it('does not stop the start-up when the browser would not show it', async () => {
      const env = await setUp({ windows: { 1: 4 }, hidden: { 1: 2 } });
      const failure = new Error('no permission');
      env.notifications.show = () => Promise.reject(failure);

      await expect(env.firstRun.decideNativeGroups()).resolves.toBeUndefined();

      expect(env.options.stored.useNativeGroups).toBe(false);
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[FirstRun] The notice could not be shown:',
        failure,
      );
    });

    it('opens the options, and takes itself away, when it is clicked', async () => {
      const env = await setUp({ windows: { 1: 4 }, hidden: { 1: 2 } });
      await env.firstRun.decideNativeGroups();

      await env.firstRun.noticeClicked(notice);

      expect(env.extension.optionsOpened).toBe(1);
      expect(env.notifications.shown.size).toBe(0);
    });

    it('opens the options even if the browser has already taken the notice away', async () => {
      const env = await setUp({ windows: { 1: 4 }, hidden: { 1: 2 } });
      env.notifications.clear = () => Promise.reject(new Error('gone'));

      await env.firstRun.noticeClicked(notice);

      expect(env.extension.optionsOpened).toBe(1);
    });

    it('leaves alone the click on any other notification', async () => {
      const env = await setUp({ windows: { 1: 4 }, hidden: { 1: 2 } });

      await env.firstRun.noticeClicked('viewer-initializing');

      expect(env.extension.optionsOpened).toBe(0);
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
