import { isReservedGroupId } from '../core/constants.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Scheduler } from '../ports/scheduler.js';

// How often, and how many times, a page looks for the groups of a window that has none yet
export const GROUPS_WAIT_EVERY_MS = 100;
export const GROUPS_WAIT_TRIES = 30;

/**
 * Settles once the window has a user group stored, or after a few seconds. A page opened with its
 * window (`windows.create` with the view's address) can load before the background has made the
 * window's first group; built on none, it would show none, and could store none over the
 * background's. A wait that runs out is logged, and the page is shown all the same.
 */
export async function waitForStoredGroups(
  groupState: Pick<GroupState, 'getGroups'>,
  scheduler: Pick<Scheduler, 'setTimeout'>,
  logger: Pick<Logger, 'warn'>,
  windowId: number,
): Promise<void> {
  const look = async (left: number): Promise<void> => {
    const groups = await groupState.getGroups(windowId);
    // The group for ungrouped tabs is not one of the user's
    if (groups?.some(({ id }) => !isReservedGroupId(id)) === true) {
      return;
    }
    if (left <= 1) {
      logger.warn(
        `[View] Window ${String(windowId)} has no groups after ${String((GROUPS_WAIT_TRIES * GROUPS_WAIT_EVERY_MS) / 1000)} seconds; shown without them`,
      );
      return;
    }
    await new Promise<void>((resolve) => {
      scheduler.setTimeout(resolve, GROUPS_WAIT_EVERY_MS);
    });
    await look(left - 1);
  };
  await look(GROUPS_WAIT_TRIES);
}
