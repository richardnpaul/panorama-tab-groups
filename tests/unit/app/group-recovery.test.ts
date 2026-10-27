import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryExtension } from '../../../src/js/adapters/memory/extension.js';
import { createMemoryNotifications } from '../../../src/js/adapters/memory/notifications.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import { createMemorySessionHistory } from '../../../src/js/adapters/memory/session-history.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryToolbar } from '../../../src/js/adapters/memory/toolbar.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createGroupRecovery } from '../../../src/js/app/group-recovery.js';
import { createInitialization } from '../../../src/js/app/initialization.js';
import { createInitializationUi } from '../../../src/js/app/initialization-ui.js';
import { withUngroupedGroup } from '../../../src/js/app/with-ungrouped-group.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';

const group = (id: number): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

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

interface Env {
  recovery: ReturnType<typeof createGroupRecovery>;
  groupState: ReturnType<typeof createMemoryGroupState>;
  windows: ReturnType<typeof createMemoryWindows>;
  tabs: ReturnType<typeof createMemoryTabs>;
  history: ReturnType<typeof createMemorySessionHistory>;
  initialization: ReturnType<typeof createInitialization>;
  scheduler: ReturnType<typeof createMemoryScheduler>;
  notifications: ReturnType<typeof createMemoryNotifications>;
  messaging: ReturnType<typeof createMemoryMessaging>;
  logger: {
    debug: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };
}

function setUp(): Env {
  const clock = createMemoryClock(1000);
  const groupState = withUngroupedGroup(createMemoryGroupState(), clock);
  const windows = createMemoryWindows(1);
  const tabs = createMemoryTabs();
  const history = createMemorySessionHistory();
  const scheduler = createMemoryScheduler();
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const initialization = createInitialization({ clock, scheduler, logger });
  const notifications = createMemoryNotifications();
  const messaging = createMemoryMessaging();
  const ui = createInitializationUi({
    notifications,
    toolbar: createMemoryToolbar(),
    messaging,
    extension: createMemoryExtension(),
    logger,
  });
  return {
    recovery: createGroupRecovery({
      groupState,
      tabs,
      windows,
      sessionHistory: history,
      initialization,
      ui,
      scheduler,
      logger,
    }),
    groupState,
    windows,
    tabs,
    history,
    initialization,
    scheduler,
    notifications,
    messaging,
    logger,
  };
}

describe('app/group-recovery.ts', () => {
  describe('initializeTabGroupAssignments', () => {
    it('keeps the group each tab was in when the group still exists', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1), group(2)]);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, 2);

      await env.recovery.initializeTabGroupAssignments();

      expect(await env.groupState.getTabGroup(10)).toBe(1);
      expect(await env.groupState.getTabGroup(11)).toBe(2);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Complete: 2 recovered, 0 assigned to ungrouped',
      );
    });

    it('puts a tab whose group is gone in the group for ungrouped tabs', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      env.tabs.setDetails([tab(10, 1)]);
      await env.groupState.setTabGroup(10, 5);

      await env.recovery.initializeTabGroupAssignments();

      expect(await env.groupState.getTabGroup(10)).toBe(-2);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Tab 10 group 5 no longer exists, assigning to ungrouped',
      );
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Complete: 1 recovered, 1 assigned to ungrouped',
      );
    });

    it('puts a tab that has no group in the group for ungrouped tabs', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      env.tabs.setDetails([tab(10, 1)]);

      await env.recovery.initializeTabGroupAssignments();

      expect(await env.groupState.getTabGroup(10)).toBe(-2);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Complete: 0 recovered, 1 assigned to ungrouped',
      );
    });

    it.each([[-1], [-2]])(
      'keeps the reserved group %i of a tab',
      async (reserved) => {
        const env = setUp();
        await env.groupState.setGroups(1, [group(1)]);
        env.tabs.setDetails([tab(10, 1)]);
        await env.groupState.setTabGroup(10, reserved);

        await env.recovery.initializeTabGroupAssignments();

        expect(await env.groupState.getTabGroup(10)).toBe(reserved);
      },
    );

    it('keeps the group 0 of a tab', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(0)]);
      env.tabs.setDetails([tab(10, 1)]);
      await env.groupState.setTabGroup(10, 0);

      await env.recovery.initializeTabGroupAssignments();

      expect(await env.groupState.getTabGroup(10)).toBe(0);
    });

    it('puts every tab in the group for ungrouped tabs when the session history is not available', async () => {
      const env = setUp();
      env.history.disable('history disabled');
      await env.groupState.setGroups(1, [group(1)]);
      env.tabs.setDetails([tab(10, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.recovery.initializeTabGroupAssignments();

      expect(await env.groupState.getTabGroup(10)).toBe(-2);
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Initialization] Session history not available:',
        'history disabled',
      );
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Initialization] Session history disabled, all tabs will be assigned to ungrouped',
      );
    });

    it('reports a history failure that is not an error as it is', async () => {
      const env = setUp();
      env.history.probe = vi.fn().mockRejectedValue('no history');

      await env.recovery.initializeTabGroupAssignments();

      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Initialization] Session history not available:',
        'no history',
      );
    });

    it('treats a tab whose group cannot be read as having none', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      env.tabs.setDetails([tab(10, 1)]);
      const failure = new Error('unreadable');
      env.groupState.getTabGroup = () => Promise.reject(failure);

      await env.recovery.initializeTabGroupAssignments();

      expect(
        await env.groupState.getTabGroup(10).catch(() => 'unreadable'),
      ).toBe('unreadable');
      expect(env.logger.warn).toHaveBeenCalledWith(
        '[Initialization] Could not recover group for tab 10:',
        failure,
      );
    });

    it('stores the groups of each window, which adds the group for ungrouped tabs', async () => {
      const env = setUp();
      const raw = createMemoryGroupState();
      await raw.setGroups(1, [group(1)]);
      const stored = vi.fn(() => Promise.resolve());
      env.groupState.getGroups = (windowId) => raw.getGroups(windowId);
      env.groupState.setGroups = stored;

      await env.recovery.initializeTabGroupAssignments();

      expect(stored).toHaveBeenCalledTimes(1);
      expect(stored).toHaveBeenCalledWith(1, [group(1)]);
    });

    it('leaves a window alone that has no groups, or an empty list of them', async () => {
      const env = setUp();
      env.windows.open(2);
      env.tabs.setDetails([tab(10, 1), tab(20, 2)]);
      const raw = createMemoryGroupState();
      await raw.setGroups(2, []);
      env.groupState.getGroups = (windowId) => raw.getGroups(windowId);

      await env.recovery.initializeTabGroupAssignments();

      expect(await env.groupState.getTabGroup(10)).toBeUndefined();
      expect(await env.groupState.getTabGroup(20)).toBeUndefined();
    });

    it('adds up what it did over all the windows', async () => {
      const env = setUp();
      env.windows.open(2);
      await env.groupState.setGroups(1, [group(1)]);
      await env.groupState.setGroups(2, [group(3)]);
      env.tabs.setDetails([tab(10, 1), tab(11, 1), tab(20, 2)]);
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(20, 3);

      await env.recovery.initializeTabGroupAssignments();

      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Complete: 2 recovered, 1 assigned to ungrouped',
      );
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Window 1: processed 2 tabs',
      );
    });

    it('says nothing was recovered when there are no windows with groups', async () => {
      const env = setUp();

      await env.recovery.initializeTabGroupAssignments();

      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Complete: 0 recovered, 0 assigned to ungrouped',
      );
    });

    it('says it is starting', async () => {
      const env = setUp();

      await env.recovery.initializeTabGroupAssignments();

      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Starting tab group assignment recovery (max 10s)...',
      );
    });

    it('does not say a tab was reassigned that was not', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      env.tabs.setDetails([tab(10, 1), tab(11, 1)]);
      await env.groupState.setTabGroup(10, 1);

      await env.recovery.initializeTabGroupAssignments();

      expect(env.logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('no longer exists'),
      );
    });

    it('is under way while it runs, and over after', async () => {
      const env = setUp();
      let during: boolean | undefined;
      env.history.probe = () => {
        during = env.initialization.isInitializing();
        return Promise.resolve();
      };
      env.initialization.finish();

      await env.recovery.initializeTabGroupAssignments();

      expect(during).toBe(true);
      expect(env.initialization.isInitializing()).toBe(false);
      expect(env.initialization.startedAt()).toBe(1000);
      expect(env.scheduler.pending()).toBe(0);
    });

    it('logs a failure and still ends', async () => {
      const env = setUp();
      const failure = new Error('no windows');
      env.windows.listIds = () => Promise.reject(failure);

      await env.recovery.initializeTabGroupAssignments();

      expect(env.logger.error).toHaveBeenCalledWith(
        '[Initialization] Error during tab assignment:',
        failure,
      );
      expect(env.initialization.isInitializing()).toBe(false);
    });

    describe('when it takes long', () => {
      const slow = (env: Env) => {
        let release: () => void = () => undefined;
        env.history.probe = () =>
          new Promise<void>((resolve) => {
            release = resolve;
          });
        return () => {
          release();
        };
      };

      it('shows the loading UI after a second', async () => {
        const env = setUp();
        const finish = slow(env);
        const running = env.recovery.initializeTabGroupAssignments();

        env.scheduler.advance(999);
        expect(env.notifications.shown.size).toBe(0);
        env.scheduler.advance(1);
        await Promise.resolve();
        await Promise.resolve();
        expect(env.notifications.shown.size).toBe(1);

        finish();
        await running;
      });

      it('hides the loading UI when it is over', async () => {
        const env = setUp();
        const finish = slow(env);
        const running = env.recovery.initializeTabGroupAssignments();
        env.scheduler.advance(1000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        finish();
        await running;

        expect(env.notifications.shown.size).toBe(0);
        expect(env.messaging.sent.at(-1)).toEqual({
          action: 'hideInitializationLoading',
        });
      });

      it('does not show the loading UI once it is over', async () => {
        const env = setUp();
        const finish = slow(env);
        const running = env.recovery.initializeTabGroupAssignments();
        finish();
        await running;

        expect(env.notifications.shown.size).toBe(0);
        expect(env.scheduler.pending()).toBe(0);
      });

      it('does not show the loading UI when events were let go ahead before the second', async () => {
        const env = setUp();
        const finish = slow(env);
        const running = env.recovery.initializeTabGroupAssignments();
        env.initialization.finish();

        env.scheduler.advance(1000);
        await Promise.resolve();

        expect(env.notifications.shown.size).toBe(0);
        finish();
        await running;
      });

      it('says so when the loading UI cannot be shown', async () => {
        const env = setUp();
        const failure = new Error('no notifications');
        env.notifications.show = () => Promise.reject(failure);
        const finish = slow(env);
        const running = env.recovery.initializeTabGroupAssignments();

        env.scheduler.advance(1000);
        await Promise.resolve();
        await Promise.resolve();

        expect(env.logger.error).toHaveBeenCalledWith(
          '[Initialization] Could not show the loading UI:',
          failure,
        );
        finish();
        await running;
      });

      it('says so when the loading UI cannot be hidden, and still ends', async () => {
        const env = setUp();
        const failure = new Error('cannot clear');
        env.notifications.clear = () => Promise.reject(failure);
        const finish = slow(env);
        const running = env.recovery.initializeTabGroupAssignments();
        env.scheduler.advance(1000);
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        finish();
        await running;

        expect(env.logger.error).toHaveBeenCalledWith(
          '[Initialization] Could not hide the loading UI:',
          failure,
        );
        expect(env.initialization.isInitializing()).toBe(false);
      });

      it('lets events go ahead after ten seconds, and says so', async () => {
        const env = setUp();
        const finish = slow(env);
        const running = env.recovery.initializeTabGroupAssignments();

        env.scheduler.advance(9999);
        expect(env.initialization.isInitializing()).toBe(true);
        env.scheduler.advance(1);

        expect(env.initialization.isInitializing()).toBe(false);
        expect(env.logger.warn).toHaveBeenCalledWith(
          '[Initialization] Timeout reached (10s), unblocking operations',
        );
        finish();
        await running;
      });

      it('does not complain about the time when it ended by itself', async () => {
        const env = setUp();
        await env.recovery.initializeTabGroupAssignments();

        env.scheduler.advance(20000);

        expect(env.logger.warn).not.toHaveBeenCalled();
      });

      it('does not complain about the time when events were let go ahead already', async () => {
        const env = setUp();
        const finish = slow(env);
        const running = env.recovery.initializeTabGroupAssignments();
        env.initialization.finish();

        env.scheduler.advance(10000);

        expect(env.logger.warn).not.toHaveBeenCalledWith(
          '[Initialization] Timeout reached (10s), unblocking operations',
        );
        finish();
        await running;
      });
    });
  });

  describe('salvageGrouplessTabs', () => {
    it('puts a tab that has no group in the active group of its window', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1), group(2)]);
      await env.groupState.setActiveGroup(1, 2);
      env.tabs.setDetails([tab(10, 1)]);

      await env.recovery.salvageGrouplessTabs();

      expect(await env.groupState.getTabGroup(10)).toBe(2);
    });

    it('puts a tab whose group is gone in the active group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      env.tabs.setDetails([tab(10, 1)]);
      await env.groupState.setTabGroup(10, 8);

      await env.recovery.salvageGrouplessTabs();

      expect(await env.groupState.getTabGroup(10)).toBe(1);
    });

    it.each([[-1], [-2], [1]])(
      'leaves a tab in the group %i, which exists',
      async (existing) => {
        const env = setUp();
        await env.groupState.setGroups(1, [group(1), group(2)]);
        await env.groupState.setActiveGroup(1, 2);
        env.tabs.setDetails([tab(10, 1)]);
        await env.groupState.setTabGroup(10, existing);

        await env.recovery.salvageGrouplessTabs();

        expect(await env.groupState.getTabGroup(10)).toBe(existing);
      },
    );

    it('uses the active group of the window each tab is in', async () => {
      const env = setUp();
      env.windows.open(2);
      await env.groupState.setGroups(1, [group(1)]);
      await env.groupState.setActiveGroup(1, 1);
      await env.groupState.setGroups(2, [group(7)]);
      await env.groupState.setActiveGroup(2, 7);
      env.tabs.setDetails([tab(10, 1), tab(20, 2)]);

      await env.recovery.salvageGrouplessTabs();

      expect(await env.groupState.getTabGroup(10)).toBe(1);
      expect(await env.groupState.getTabGroup(20)).toBe(7);
    });

    it('skips a window that has no groups', async () => {
      const env = setUp();
      env.tabs.setDetails([tab(10, 1)]);

      await env.recovery.salvageGrouplessTabs();

      expect(await env.groupState.getTabGroup(10)).toBeUndefined();
      expect(env.logger.debug).toHaveBeenCalledWith(
        'No groups found for window 1',
      );
    });

    it('skips a window that has no active group', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(1)]);
      env.tabs.setDetails([tab(10, 1)]);

      await env.recovery.salvageGrouplessTabs();

      expect(await env.groupState.getTabGroup(10)).toBeUndefined();
      expect(env.logger.debug).toHaveBeenCalledWith(
        'No active group in window 1',
      );
    });

    it('puts tabs in the active group 0', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(0)]);
      await env.groupState.setActiveGroup(1, 0);
      env.tabs.setDetails([tab(10, 1)]);

      await env.recovery.salvageGrouplessTabs();

      expect(await env.groupState.getTabGroup(10)).toBe(0);
    });
  });
});
