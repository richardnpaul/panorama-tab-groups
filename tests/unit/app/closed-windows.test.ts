import { describe, expect, it, vi } from 'vitest';
import { createBrowserGroupState } from '../../../src/js/adapters/browser/group-state.js';
import { createSessionsEmulation } from '../../../src/js/adapters/browser/sessions-emulation.js';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createClosedWindows } from '../../../src/js/app/closed-windows.js';
import {
  CLOSED_WINDOW_KEPT_MS,
  CLOSED_WINDOWS_KEPT,
} from '../../../src/js/core/constants.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';
import { createFakeStorage } from '../../support/fake-storage.js';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1000;

const tab = (id: number, windowId: number): TabDetails => ({
  id,
  windowId,
  active: false,
  pinned: false,
  url: undefined,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
});

function setUp({ open = [1] }: { open?: number[] } = {}) {
  const groupState = createMemoryGroupState();
  const windows = createMemoryWindows(open[0] ?? 1);
  open.slice(1).forEach((id) => {
    windows.open(id);
  });
  const tabs = createMemoryTabs();
  const clock = createMemoryClock(NOW);
  const logger = { debug: vi.fn(), warn: vi.fn() };
  return {
    closed: createClosedWindows({
      groupState,
      windows,
      tabs,
      clock,
      logger,
    }),
    groupState,
    windows,
    tabs,
    clock,
    logger,
  };
}

type Env = ReturnType<typeof setUp>;

/** A window that is not open, with groups kept, that closed this long ago (never, if not said) */
async function keep(env: Env, windowId: number, closedAgo?: number) {
  await env.groupState.setGroupIndex(windowId, 1);
  if (closedAgo !== undefined) {
    await env.groupState.setClosedAt(windowId, NOW - closedAgo);
  }
}

describe('app/closed-windows.ts', () => {
  describe('tabClosed', () => {
    it('lets go of what is kept for the tab, and for no other', async () => {
      const env = setUp();
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, 1);

      await env.closed.tabClosed(10);

      expect(await env.groupState.listStoredTabIds()).toEqual([11]);
    });
  });

  describe('tabClosed, when letting go fails', () => {
    it('says so and does not reject, so what is done for the tab after it is done', async () => {
      const env = setUp();
      const failure = new Error('storage is full');
      vi.spyOn(env.groupState, 'forgetTab').mockRejectedValue(failure);

      await expect(env.closed.tabClosed(10)).resolves.toBeUndefined();

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Closed] Tab 10 could not be let go of:',
        failure,
      );
    });
  });

  describe('windowClosed', () => {
    it('dates a window it has values for', async () => {
      const env = setUp();
      await env.groupState.setGroupIndex(5, 1);

      await env.closed.windowClosed(5);

      expect(await env.groupState.getClosedAt(5)).toBe(NOW);
    });

    it('keeps nothing of a window it has no values for', async () => {
      const env = setUp();

      await env.closed.windowClosed(5);

      expect(await env.groupState.listStoredWindowIds()).toEqual([]);
    });

    it('keeps the most recent windows, and lets go of the one that closed longest ago', async () => {
      const env = setUp();
      await Promise.all(
        Array.from({ length: CLOSED_WINDOWS_KEPT }, (_, at) =>
          keep(env, 10 + at, (at + 1) * HOUR),
        ),
      );
      await env.groupState.setGroupIndex(99, 1);

      await env.closed.windowClosed(99);

      // 99 closed now, so the window that closed longest ago goes
      const left = (await env.groupState.listStoredWindowIds()).sort();
      expect(left).toEqual([10, 11, 12, 13, 99]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        `[Closed] Let go of what was kept of window ${String(10 + CLOSED_WINDOWS_KEPT - 1)}`,
      );
    });

    it('lets go of a window that closed longer ago than it is kept, however few there are', async () => {
      const env = setUp();
      await keep(env, 10, CLOSED_WINDOW_KEPT_MS + 1);
      await keep(env, 11, CLOSED_WINDOW_KEPT_MS);

      await env.closed.windowClosed(99);

      expect(await env.groupState.listStoredWindowIds()).toEqual([11]);
    });

    it('does not let go of a window that is open', async () => {
      const env = setUp({ open: [1, 2] });
      await keep(env, 2, CLOSED_WINDOW_KEPT_MS * 3);

      await env.closed.windowClosed(99);

      expect(await env.groupState.listStoredWindowIds()).toEqual([2]);
    });

    it('says so, and goes on, when it cannot', async () => {
      const env = setUp();
      const failure = new Error('storage is full');
      vi.spyOn(env.groupState, 'listStoredWindowIds').mockRejectedValue(
        failure,
      );

      await expect(env.closed.windowClosed(5)).resolves.toBeUndefined();

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Closed] Window 5 could not be kept:',
        failure,
      );
    });
  });

  describe('private windows, where Chromium keeps the values', () => {
    // The add-on's values, as Chromium keeps them; window 3 and tab 30 are private
    function chromium({ open = [2, 3] }: { open?: number[] } = {}) {
      const storage = createFakeStorage();
      const privateWindows = new Set([3]);
      const sessions = createSessionsEmulation(
        () => storage.area,
        undefined,
        (scope, id) =>
          Promise.resolve(
            scope === 'tabs' ? id === 30 : privateWindows.has(id),
          ),
      );
      const groupState = createBrowserGroupState(() => ({
        sessions,
        sessionsManagement: sessions,
      }));
      const windows = createMemoryWindows(open[0] ?? 2);
      open.slice(1).forEach((id) => {
        if (privateWindows.has(id)) {
          windows.makePrivate(id);
        } else {
          windows.open(id);
        }
      });
      const tabs = createMemoryTabs();
      const logger = { debug: vi.fn(), warn: vi.fn() };
      const closed = createClosedWindows({
        groupState,
        windows,
        tabs,
        clock: createMemoryClock(NOW),
        logger,
      });
      return { closed, groupState, sessions, storage, windows, tabs, logger };
    }

    it('lets go of a private window at once when it closes, and keeps one that is not private', async () => {
      const env = chromium();
      await env.groupState.setGroups(2, []);
      await env.groupState.setGroups(3, []);
      env.windows.close(2);
      env.windows.close(3);

      await env.closed.windowClosed(2);
      await env.closed.windowClosed(3);

      expect(await env.groupState.listStoredWindowIds()).toEqual([2]);
      expect(await env.groupState.listPrivateWindowIds()).toEqual([]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Closed] Let go of the values of private window 3',
      );
    });

    it('keeps an open private window when another closes', async () => {
      const env = chromium();
      await env.groupState.setGroups(3, []);
      env.windows.close(2);

      await env.closed.windowClosed(2);

      expect(await env.groupState.listPrivateWindowIds()).toEqual([3]);
    });

    it('lets go at start-up of the private windows and tabs that are not open, as after a crash', async () => {
      const env = chromium({ open: [2] });
      await env.groupState.setGroups(3, []);
      await env.groupState.setTabGroup(30, 1);

      await env.closed.prune();

      expect(await env.groupState.listPrivateWindowIds()).toEqual([]);
      expect(await env.groupState.listPrivateTabIds()).toEqual([]);
    });

    it('keeps at start-up the private windows and tabs that are open, as after an update', async () => {
      const env = chromium();
      env.tabs.setDetails([tab(30, 3)]);
      await env.groupState.setGroups(3, []);
      await env.groupState.setTabGroup(30, 1);

      await env.closed.prune();

      expect(await env.groupState.listPrivateWindowIds()).toEqual([3]);
      expect(await env.groupState.listPrivateTabIds()).toEqual([30]);
    });

    it('moves apart at start-up what an open private window stored with the others before', async () => {
      const env = chromium();
      env.tabs.setDetails([tab(30, 3), tab(20, 2)]);
      await env.storage.area.set({
        __mock_sessions: {
          windows: { 2: { groupIndex: 1 }, 3: { groupIndex: 1 } },
          tabs: { 20: { groupId: 1 }, 30: { groupId: 1 } },
        },
      });

      await env.closed.prune();

      expect(await env.groupState.listStoredWindowIds()).toEqual([2]);
      expect(await env.groupState.listStoredTabIds()).toEqual([20]);
      expect(await env.groupState.listPrivateWindowIds()).toEqual([3]);
      expect(await env.groupState.listPrivateTabIds()).toEqual([30]);
    });

    it('moves nothing at start-up where no private window is open', async () => {
      const env = chromium({ open: [2] });
      const setPrivate = vi.spyOn(env.groupState, 'setPrivate');

      await env.closed.prune();

      expect(setPrivate).not.toHaveBeenCalled();
    });

    it('still prunes at start-up when the private windows cannot be moved apart, and says so', async () => {
      const env = chromium({ open: [2] });
      const failure = new Error('no windows');
      vi.spyOn(env.windows, 'listPrivateIds').mockRejectedValue(failure);
      await env.groupState.setGroups(3, []);

      await env.closed.prune();

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Closed] The values of the private windows could not be moved apart:',
        failure,
      );
      expect(await env.groupState.listPrivateWindowIds()).toEqual([]);
    });

    it('still lets go of the old when a private window cannot be let go of, and says so', async () => {
      const env = chromium();
      const failure = new Error('storage is full');
      vi.spyOn(env.groupState, 'listPrivateWindowIds').mockRejectedValue(
        failure,
      );
      const setClosedAt = vi.spyOn(env.groupState, 'setClosedAt');
      await env.groupState.setGroups(2, []);
      env.windows.close(2);

      await env.closed.windowClosed(2);

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Closed] What window 2 kept apart, if it was private, could not be let go of:',
        failure,
      );
      expect(setClosedAt).toHaveBeenCalledWith(2, NOW);
    });
  });

  describe('a window or tab that opens while it looks', () => {
    // Right after the first of the two looks, whichever it is, `opening` happens
    function between(opening: () => Promise<void>) {
      let opened = false;
      return async <T>(look: Promise<T>): Promise<T> => {
        const seen = await look;
        if (!opened) {
          opened = true;
          await opening();
        }
        return seen;
      };
    }

    it('does not date a window that opens, and is stored, between the look at what is stored and at what is open', async () => {
      const env = setUp();
      const after = between(async () => {
        env.windows.open(9);
        await env.groupState.setGroupIndex(9, 1);
      });
      const listIds = env.windows.listIds.bind(env.windows);
      const listStored = env.groupState.listStoredWindowIds.bind(
        env.groupState,
      );
      vi.spyOn(env.windows, 'listIds').mockImplementation(() =>
        after(listIds()),
      );
      vi.spyOn(env.groupState, 'listStoredWindowIds').mockImplementation(() =>
        after(listStored()),
      );

      await env.closed.windowClosed(5);

      expect(await env.groupState.getClosedAt(9)).toBeUndefined();
    });

    it('does not let go of a tab that opens, and is stored, between the look at what is stored and at what is open', async () => {
      const env = setUp();
      const after = between(async () => {
        env.tabs.setDetails([tab(90, 1)]);
        await env.groupState.setTabGroup(90, 1);
      });
      const listTabs = env.tabs.listSummariesInWindow.bind(env.tabs);
      const listStored = env.groupState.listStoredTabIds.bind(env.groupState);
      vi.spyOn(env.tabs, 'listSummariesInWindow').mockImplementation((id) =>
        after(listTabs(id)),
      );
      vi.spyOn(env.groupState, 'listStoredTabIds').mockImplementation(() =>
        after(listStored()),
      );

      await env.closed.prune();

      expect(await env.groupState.getTabGroup(90)).toBe(1);
    });
  });

  describe('prune', () => {
    it('lets go of the values of tabs that are not open, in any window', async () => {
      const env = setUp({ open: [1, 2] });
      env.tabs.setDetails([tab(10, 1), tab(11, 2)]);
      await Promise.all(
        [10, 11, 12, 13].map((id) => env.groupState.setTabGroup(id, 1)),
      );

      await env.closed.prune();

      expect((await env.groupState.listStoredTabIds()).sort()).toEqual([
        10, 11,
      ]);
    });

    it('dates the windows it has no date for from now, so the clock counts while the browser runs', async () => {
      const env = setUp();
      await keep(env, 7);

      await env.closed.prune();

      expect(await env.groupState.getClosedAt(7)).toBe(NOW);
      expect(await env.groupState.listStoredWindowIds()).toEqual([7]);
    });

    it('keeps the date a window has', async () => {
      const env = setUp();
      await keep(env, 7, 3 * HOUR);

      await env.closed.prune();

      expect(await env.groupState.getClosedAt(7)).toBe(NOW - 3 * HOUR);
    });

    it('lets go of windows beyond the most recent, among those it has just dated and those it had', async () => {
      const env = setUp();
      await Promise.all(
        Array.from({ length: CLOSED_WINDOWS_KEPT }, (_, at) =>
          keep(env, 20 + at, (at + 1) * HOUR),
        ),
      );
      // Not dated: it closed with the browser, which counts from now
      await keep(env, 30);

      await env.closed.prune();

      const left = (await env.groupState.listStoredWindowIds()).sort();
      expect(left).toEqual([20, 21, 22, 23, 30]);
    });

    it('leaves a window that is open', async () => {
      const env = setUp({ open: [1, 7] });
      await keep(env, 7);

      await env.closed.prune();

      expect(await env.groupState.getClosedAt(7)).toBeUndefined();
    });

    it('says so, and goes on, when it cannot', async () => {
      const env = setUp();
      const failure = new Error('no windows');
      vi.spyOn(env.windows, 'listIds').mockRejectedValue(failure);

      await expect(env.closed.prune()).resolves.toBeUndefined();

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Closed] What is kept could not be pruned:',
        failure,
      );
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Closed] The windows kept could not be let go of:',
        failure,
      );
    });
  });
});
