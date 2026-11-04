import {
  CLOSED_WINDOW_KEPT_MS,
  CLOSED_WINDOWS_KEPT,
} from '../core/constants.js';
import type { Clock } from '../ports/clock.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';

export interface ClosedWindowsDeps {
  /**
   * What is stored, as it is: the windows that closed are not brought up to date. A private
   * window's values are kept apart from what is stored to be kept (see the sessions emulation),
   * so nothing of one is kept for a window that comes back.
   */
  groupState: Pick<
    GroupState,
    | 'listStoredWindowIds'
    | 'listStoredTabIds'
    | 'listPrivateWindowIds'
    | 'listPrivateTabIds'
    | 'setPrivate'
    | 'forgetWindow'
    | 'forgetTab'
    | 'getClosedAt'
    | 'setClosedAt'
  >;
  windows: Pick<Windows, 'listIds' | 'listPrivateIds'>;
  tabs: Pick<Tabs, 'listSummariesInWindow'>;
  clock: Clock;
  logger: Pick<Logger, 'debug' | 'warn'>;
}

export interface ClosedWindows {
  /** A tab was closed: what is kept for it has no reader, as a tab that comes back has a new id. Never rejects. */
  tabClosed: (tabId: number) => Promise<void>;
  /**
   * A window was closed: its groups are kept for a while, and what is older is let go. A private
   * window's values are let go at once. Never rejects.
   */
  windowClosed: (windowId: number) => Promise<void>;
  /**
   * Start-up, once the windows that were open are back and have used what was kept: let go
   * of the values of tabs that are not open, and date what is kept of windows that are not
   * (the clock counts while the browser runs, not while it was closed), and let go of the old.
   * The values of private windows and tabs that are not open are let go of: the browser was
   * closed, or stopped, before the add-on saw them close. Never rejects.
   */
  prune: () => Promise<void>;
}

export function createClosedWindows({
  groupState,
  windows,
  tabs,
  clock,
  logger,
}: ClosedWindowsDeps): ClosedWindows {
  // Each step goes on whether the one before it worked or not, and says so when it did not
  async function attempt(
    failure: string,
    step: () => Promise<void>,
  ): Promise<void> {
    try {
      await step();
    } catch (error) {
      logger.warn(failure, error);
    }
  }

  // The windows of what is stored that are not open, each with when it closed (now, if not said).
  // What is stored is read before what is open, here and below: a window or tab stored by then
  // was there before the look at what is open, so one that opens in between is not taken for one
  // that has closed.
  async function closed(): Promise<{ windowId: number; at: number }[]> {
    const stored = await groupState.listStoredWindowIds();
    const open = new Set(await windows.listIds());
    const now = clock.now();
    return Promise.all(
      stored
        .filter((id) => !open.has(id))
        .map(async (windowId) => {
          const known = await groupState.getClosedAt(windowId);
          if (known !== undefined) {
            return { windowId, at: known };
          }
          await groupState.setClosedAt(windowId, now);
          return { windowId, at: now };
        }),
    );
  }

  // The most recent are kept, and none older than the limit
  async function letGoOfTheOld(): Promise<void> {
    const now = clock.now();
    const byRecent = (await closed()).sort(
      (first, second) => second.at - first.at,
    );
    await Promise.all(
      byRecent
        .filter(
          ({ at }, place) =>
            place >= CLOSED_WINDOWS_KEPT || now - at > CLOSED_WINDOW_KEPT_MS,
        )
        .map(async ({ windowId }) => {
          await groupState.forgetWindow(windowId);
          logger.debug(
            `[Closed] Let go of what was kept of window ${String(windowId)}`,
          );
        }),
    );
  }

  // The tabs of the windows that are open
  async function openTabIds(windowIds: readonly number[]): Promise<number[]> {
    return (
      await Promise.all(windowIds.map((id) => tabs.listSummariesInWindow(id)))
    )
      .flat()
      .map(({ id }) => id);
  }

  // TEMPORARY (plan F11): the values a private window that is open had stored with the others,
  // before they were kept apart, are moved apart. To be removed once no such version is in use.
  async function setOpenPrivateApart(): Promise<void> {
    const privateIds = await windows.listPrivateIds();
    if (privateIds.length > 0) {
      await groupState.setPrivate(privateIds, await openTabIds(privateIds));
    }
  }

  async function letGoOfPrivateWindows(
    windowIds: readonly number[],
  ): Promise<void> {
    await Promise.all(
      windowIds.map(async (windowId) => {
        await groupState.forgetWindow(windowId);
        logger.debug(
          `[Closed] Let go of the values of private window ${String(windowId)}`,
        );
      }),
    );
  }

  // The values of tabs, and of private windows, that are not open
  async function letGoOfWhatIsNotOpen(): Promise<void> {
    const [keptTabs, privateTabs, privateWindows] = await Promise.all([
      groupState.listStoredTabIds(),
      groupState.listPrivateTabIds(),
      groupState.listPrivateWindowIds(),
    ]);
    const openWindows = new Set(await windows.listIds());
    const openTabs = new Set(await openTabIds([...openWindows]));
    await Promise.all(
      [...keptTabs, ...privateTabs]
        .filter((id) => !openTabs.has(id))
        .map((id) => groupState.forgetTab(id)),
    );
    await letGoOfPrivateWindows(
      privateWindows.filter((id) => !openWindows.has(id)),
    );
  }

  return {
    async tabClosed(tabId) {
      await attempt(
        `[Closed] Tab ${String(tabId)} could not be let go of:`,
        () => groupState.forgetTab(tabId),
      );
    },

    async windowClosed(windowId) {
      await attempt(
        `[Closed] What window ${String(windowId)} kept apart, if it was private, could not be let go of:`,
        async () => {
          await letGoOfPrivateWindows(
            (await groupState.listPrivateWindowIds()).filter(
              (id) => id === windowId,
            ),
          );
        },
      );
      // A window of ours that is not open is dated now if it is not dated: this one, which
      // has just closed (one that has no values of ours is not kept)
      await attempt(
        `[Closed] Window ${String(windowId)} could not be kept:`,
        letGoOfTheOld,
      );
    },

    async prune() {
      await attempt(
        '[Closed] The values of the private windows could not be moved apart:',
        setOpenPrivateApart,
      );
      await attempt(
        '[Closed] What is kept could not be pruned:',
        letGoOfWhatIsNotOpen,
      );
      await attempt(
        '[Closed] The windows kept could not be let go of:',
        letGoOfTheOld,
      );
    },
  };
}
