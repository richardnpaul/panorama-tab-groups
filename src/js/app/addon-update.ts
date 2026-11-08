import type { Extension } from '../ports/extension.js';
import type { Logger } from '../ports/logger.js';
import type { PendingUpdate } from '../ports/pending-update.js';
import type { Tabs } from '../ports/tabs.js';
import type { AutoBackup } from './auto-backup.js';

export interface AddonUpdateDeps {
  autoBackup: Pick<AutoBackup, 'writeNow'>;
  tabs: Pick<Tabs, 'idsOfAddressesUnder'>;
  extension: Pick<Extension, 'urlOf' | 'reload'>;
  pendingUpdate: PendingUpdate;
  logger: Pick<Logger, 'debug' | 'error'>;
}

export interface AddonUpdate {
  /**
   * A new version of the add-on is waiting. A backup is written at once, as Chrome may apply
   * the update at the next stop of the background, which nothing can hold back. The add-on then
   * starts again (which applies it) once none of its pages is open, as that ends them.
   */
  updateAvailable: () => Promise<void>;
  /** A tab was closed, which may have been the last page of the add-on that held the update back */
  tabRemoved: (tabId: number) => Promise<void>;
}

export function createAddonUpdate({
  autoBackup,
  tabs,
  extension,
  pendingUpdate,
  logger,
}: AddonUpdateDeps): AddonUpdate {
  // Remembered where the background being unloaded does not lose it, and here for a browser that
  // cannot keep it
  let waiting = false;
  // One check at a time, so two tabs closed together do not both start the add-on again
  let turn = Promise.resolve();
  const inTurn = (work: () => Promise<void>): Promise<void> => {
    turn = turn.then(work);
    return turn;
  };

  const isWaiting = async (): Promise<boolean> =>
    waiting || (await pendingUpdate.isPending());

  // The page that was just closed may still be listed while it goes
  async function reloadIfNoPageOpen(closed?: number): Promise<void> {
    const open = (await tabs.idsOfAddressesUnder(extension.urlOf(''))).filter(
      (id) => id !== closed,
    );
    if (open.length > 0) {
      logger.debug(
        `[Update] Waiting for ${String(open.length)} page(s) of the add-on to close`,
      );
      return;
    }
    waiting = false;
    // The browser clears it when the add-on starts again; a failure to do it here is no reason not to
    await pendingUpdate.set(false).catch((error: unknown) => {
      logger.error('[Update] The pending update could not be cleared:', error);
    });
    extension.reload();
  }

  return {
    async updateAvailable() {
      // Written or not, the update is the browser's to apply; a failure is logged by the backup.
      // The add-on does not start again before the backup is over, which would cut it short.
      await autoBackup.writeNow('update');
      await inTurn(async () => {
        waiting = true;
        try {
          await pendingUpdate.set(true);
        } catch (error) {
          logger.error('[Update] The update could not be remembered:', error);
        }
        try {
          await reloadIfNoPageOpen();
        } catch (error) {
          logger.error('[Update] Could not go on with the update:', error);
        }
      });
    },

    tabRemoved: (tabId) =>
      inTurn(async () => {
        try {
          if (await isWaiting()) {
            await reloadIfNoPageOpen(tabId);
          }
        } catch (error) {
          logger.error('[Update] Could not go on with the update:', error);
        }
      }),
  };
}
