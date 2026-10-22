import {
  INITIALIZATION_TIMEOUT_MS,
  isReservedGroupId,
  PANORAMA_VIEW_GROUP_ID,
  SHOW_LOADING_UI_AFTER_MS,
  UNGROUPED_GROUP_ID,
} from '../core/constants.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Scheduler } from '../ports/scheduler.js';
import type { SessionHistory } from '../ports/session-history.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { Initialization } from './initialization.js';
import type { InitializationUi } from './initialization-ui.js';

export interface GroupRecoveryDeps {
  groupState: Pick<
    GroupState,
    'getGroups' | 'setGroups' | 'getTabGroup' | 'setTabGroup' | 'getActiveGroup'
  >;
  tabs: Pick<Tabs, 'listInWindow'>;
  windows: Pick<Windows, 'listIds'>;
  sessionHistory: SessionHistory;
  initialization: Pick<Initialization, 'begin' | 'finish' | 'isInitializing'>;
  ui: Pick<InitializationUi, 'show' | 'hide'>;
  scheduler: Scheduler;
  logger: Pick<Logger, 'debug' | 'warn' | 'error'>;
}

/** What the recovery found, for the windows that had groups */
interface Tally {
  recoveredTabs: number;
  assignedToUngrouped: number;
}

const sumOf = (tallies: readonly Tally[]): Tally =>
  tallies.reduce(
    (sum, tally) => ({
      recoveredTabs: sum.recoveredTabs + tally.recoveredTabs,
      assignedToUngrouped: sum.assignedToUngrouped + tally.assignedToUngrouped,
    }),
    { recoveredTabs: 0, assignedToUngrouped: 0 },
  );

export interface GroupRecovery {
  /**
   * Work out again which group each tab is in, from what the browser kept, and
   * put the tabs whose group is gone in the group for ungrouped tabs. Events
   * wait for this, for ten seconds at most.
   */
  initializeTabGroupAssignments: () => Promise<void>;
  /** Put the tabs that have no group into the active group of their window */
  salvageGrouplessTabs: () => Promise<void>;
}

export function createGroupRecovery({
  groupState,
  tabs,
  windows,
  sessionHistory,
  initialization,
  ui,
  scheduler,
  logger,
}: GroupRecoveryDeps): GroupRecovery {
  // Whether the browser still has the record of tabs that were closed
  async function isSessionHistoryAvailable(): Promise<boolean> {
    try {
      await sessionHistory.probe();
      return true;
    } catch (error) {
      logger.warn(
        '[Initialization] Session history not available:',
        error instanceof Error ? error.message : error,
      );
      return false;
    }
  }

  // The group the browser kept for a tab, if it kept one
  async function storedGroupOf(tabId: number): Promise<number | undefined> {
    try {
      return await groupState.getTabGroup(tabId);
    } catch (error) {
      logger.warn(
        `[Initialization] Could not recover group for tab ${String(tabId)}:`,
        error,
      );
      return undefined;
    }
  }

  async function recoverTab(
    tabId: number,
    groups: readonly Group[],
    sessionAvailable: boolean,
  ): Promise<Tally> {
    const stored = sessionAvailable ? await storedGroupOf(tabId) : undefined;

    if (stored === undefined) {
      await groupState.setTabGroup(tabId, UNGROUPED_GROUP_ID);
      return { recoveredTabs: 0, assignedToUngrouped: 1 };
    }

    if (isReservedGroupId(stored) || groups.some(({ id }) => id === stored)) {
      await groupState.setTabGroup(tabId, stored);
      return { recoveredTabs: 1, assignedToUngrouped: 0 };
    }

    logger.debug(
      `[Initialization] Tab ${String(tabId)} group ${String(stored)} no longer exists, assigning to ungrouped`,
    );
    await groupState.setTabGroup(tabId, UNGROUPED_GROUP_ID);
    return { recoveredTabs: 1, assignedToUngrouped: 1 };
  }

  // What was done for each tab of the window
  async function recoverWindow(
    windowId: number,
    sessionAvailable: boolean,
  ): Promise<Tally[]> {
    const groups = await groupState.getGroups(windowId);
    if (groups === undefined || groups.length === 0) {
      // A window without groups is given its first by the setup of windows
      return [];
    }

    // Storing the groups makes sure the group for ungrouped tabs is there
    await groupState.setGroups(windowId, groups);

    const windowTabs = await tabs.listInWindow(windowId);
    const tallies = await Promise.all(
      windowTabs.map(({ id }) => recoverTab(id, groups, sessionAvailable)),
    );
    logger.debug(
      `[Initialization] Window ${String(windowId)}: processed ${String(windowTabs.length)} tabs`,
    );
    return tallies;
  }

  async function recoverAll(): Promise<void> {
    const sessionAvailable = await isSessionHistoryAvailable();
    if (!sessionAvailable) {
      logger.warn(
        '[Initialization] Session history disabled, all tabs will be assigned to ungrouped',
      );
    }

    const windowIds = await windows.listIds();
    const perWindow = await Promise.all(
      windowIds.map((id) => recoverWindow(id, sessionAvailable)),
    );
    const { recoveredTabs, assignedToUngrouped } = sumOf(perWindow.flat());

    logger.debug(
      `[Initialization] Complete: ${String(recoveredTabs)} recovered, ${String(assignedToUngrouped)} assigned to ungrouped`,
    );
  }

  async function initializeTabGroupAssignments(): Promise<void> {
    initialization.begin();
    logger.debug(
      '[Initialization] Starting tab group assignment recovery (max 10s)...',
    );

    // Tell the user if it takes long, and let events go ahead if it takes too long
    const uiTimer = scheduler.setTimeout(() => {
      if (initialization.isInitializing()) {
        ui.show().catch((error: unknown) => {
          logger.error(
            '[Initialization] Could not show the loading UI:',
            error,
          );
        });
      }
    }, SHOW_LOADING_UI_AFTER_MS);
    const maxTimer = scheduler.setTimeout(() => {
      if (initialization.isInitializing()) {
        logger.warn(
          '[Initialization] Timeout reached (10s), unblocking operations',
        );
        initialization.finish();
      }
    }, INITIALIZATION_TIMEOUT_MS);

    try {
      await recoverAll();
    } catch (error) {
      logger.error('[Initialization] Error during tab assignment:', error);
    } finally {
      scheduler.clearTimeout(uiTimer);
      scheduler.clearTimeout(maxTimer);
      await ui.hide().catch((error: unknown) => {
        logger.error('[Initialization] Could not hide the loading UI:', error);
      });
      initialization.finish();
    }
  }

  async function salvageGrouplessTabs(): Promise<void> {
    const windowIds = await windows.listIds();

    await Promise.all(
      windowIds.map(async (windowId) => {
        const groups = await groupState.getGroups(windowId);
        if (groups === undefined) {
          logger.debug(`No groups found for window ${String(windowId)}`);
          return;
        }
        const activeGroup = await groupState.getActiveGroup(windowId);
        if (activeGroup === undefined) {
          logger.debug(`No active group in window ${String(windowId)}`);
          return;
        }

        const windowTabs = await tabs.listInWindow(windowId);
        await Promise.all(
          windowTabs.map(async ({ id }) => {
            const groupId = await groupState.getTabGroup(id);
            const known =
              groupId === PANORAMA_VIEW_GROUP_ID ||
              groups.some((group) => group.id === groupId);
            if (!known) {
              await groupState.setTabGroup(id, activeGroup);
            }
          }),
        );
      }),
    );
  }

  return { initializeTabGroupAssignments, salvageGrouplessTabs };
}
