import {
  AUTO_BACKUP_COUNT,
  AUTO_BACKUP_WRITE_MS,
  AUTO_BACKUP_FOLDER,
  AUTO_BACKUP_INTERVAL_MS,
  AUTO_BACKUP_QUIET_MS,
} from '../core/constants.js';
import type { Backup } from '../core/backup.js';
import type { BackupFiles } from '../ports/backup-files.js';
import type { BackupLog } from '../ports/backup-log.js';
import type { Clock } from '../ports/clock.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Scheduler, TimerHandle } from '../ports/scheduler.js';

export interface AutoBackupDeps {
  /** The groups and tabs of every window, as a backup holds them */
  snapshot: () => Promise<Backup>;
  files: BackupFiles;
  log: BackupLog;
  clock: Clock;
  scheduler: Scheduler;
  // Whether a backup is being opened: its tabs and groups are still arriving
  isOpeningBackup: () => boolean;
  logger: Pick<Logger, 'debug' | 'error'>;
}

export interface AutoBackup {
  /**
   * Start-up has put the groups back together: changes are backed up from now on, and those made
   * before are backed up now. Before it, what is stored may hold a loss that a backup must not
   * take the place of a good one with.
   */
  start: () => void;
  /**
   * The groups changed. Once they stay unchanged for a few seconds, a backup is written if the
   * last one is older than an hour.
   */
  changed: () => void;
  /**
   * Write a backup now, whenever the last one was, as before an update. Gives false if it
   * could not be written (that is logged); never rejects.
   */
  writeNow: (reason: string) => Promise<boolean>;
  /**
   * Write a backup now, unless one was written within the hour, which holds the groups as they
   * are: as before a migration that is tried again at each start until it is done, where a backup
   * each time would push the older ones out. Gives false if it could not be written; never rejects.
   */
  writeIfDue: (reason: string) => Promise<boolean>;
}

/** The path of a backup file, from its number */
export const autoBackupPath = (number: number): string =>
  `${AUTO_BACKUP_FOLDER}/backup-${String(number)}.json`;

export function createAutoBackup({
  snapshot,
  files,
  log,
  clock,
  scheduler,
  isOpeningBackup,
  logger,
}: AutoBackupDeps): AutoBackup {
  let started = false;
  // A change came before start-up was done, as a tab opened while the browser starts
  let changedBeforeStart = false;
  let timer: TimerHandle | undefined;
  // Whether a backup is put off, as one is being opened
  let puttingOff = false;
  // One backup at a time: two would write the same file and count it once
  let queue: Promise<unknown> = Promise.resolve();

  // A download can stay unfinished for ever; the backup then fails, and says so, and the next goes
  // on. The write is told to stop, so that nothing of it is left waiting.
  function withinTime(
    work: (stop: AbortSignal) => Promise<void>,
  ): Promise<void> {
    const stopping = new AbortController();
    return new Promise((resolve, reject) => {
      const limit = scheduler.setTimeout(() => {
        stopping.abort();
        reject(
          new Error(
            `The backup file was not written within ${String(AUTO_BACKUP_WRITE_MS / 1000)} seconds`,
          ),
        );
      }, AUTO_BACKUP_WRITE_MS);
      work(stopping.signal).then(
        () => {
          scheduler.clearTimeout(limit);
          resolve();
        },
        (error: unknown) => {
          scheduler.clearTimeout(limit);
          reject(error instanceof Error ? error : new Error(String(error)));
        },
      );
    });
  }

  async function write(reason: string): Promise<void> {
    const { next } = await log.read();
    const now = clock.now();
    const backup = {
      ...(await snapshot()),
      savedAt: new Date(now).toISOString(),
    };
    await withinTime((stop) =>
      files.write(
        JSON.stringify(backup, null, '\t'),
        autoBackupPath(next),
        stop,
      ),
    );
    await log.write({ next: (next % AUTO_BACKUP_COUNT) + 1, last: now });
    logger.debug(`[AutoBackup] Wrote backup ${String(next)} (${reason})`);
  }

  function writeNow(reason: string): Promise<boolean> {
    // The queue never rejects, as each backup's failure is reported here
    const result = queue
      .then(() => write(reason))
      .then(
        () => true,
        (error: unknown) => {
          logger.error(`[AutoBackup] The backup (${reason}) failed:`, error);
          return false;
        },
      );
    queue = result;
    return result;
  }

  async function wroteRecently(): Promise<boolean> {
    const { last } = await log.read();
    const since = last === undefined ? undefined : clock.now() - last;
    // A last backup in the future was written while the clock was ahead: it is not a recent one,
    // or no backup would be written until the clock reached it
    return since !== undefined && since >= 0 && since < AUTO_BACKUP_INTERVAL_MS;
  }

  async function writeIfDue(reason: string): Promise<boolean> {
    try {
      if (await wroteRecently()) {
        logger.debug(
          `[AutoBackup] No backup (${reason}): the last is less than an hour old`,
        );
        return true;
      }
    } catch (error) {
      logger.error(
        '[AutoBackup] Could not tell when the last backup was:',
        error,
      );
    }
    return writeNow(reason);
  }

  // `again` waits once more
  async function whenQuiet(again: () => void): Promise<void> {
    timer = undefined;
    // The tabs of a backup being opened are still arriving; wait until they have. Said once for
    // each wait, as the options page that opens it may be closed before it says it is done.
    if (isOpeningBackup()) {
      if (!puttingOff) {
        puttingOff = true;
        logger.debug(
          '[AutoBackup] Put off while a backup is being opened, until it is',
        );
      }
      again();
      return;
    }
    puttingOff = false;
    if (await wroteRecently()) {
      return;
    }
    await writeNow('changes');
  }

  function changed(): void {
    if (!started) {
      changedBeforeStart = true;
      return;
    }
    if (timer !== undefined) {
      scheduler.clearTimeout(timer);
    }
    timer = scheduler.setTimeout(() => {
      whenQuiet(changed).catch((error: unknown) => {
        logger.error(
          '[AutoBackup] Could not tell when the last backup was:',
          error,
        );
      });
    }, AUTO_BACKUP_QUIET_MS);
  }

  return {
    start() {
      started = true;
      if (changedBeforeStart) {
        changed();
      }
    },
    changed,
    writeNow,
    writeIfDue,
  };
}

/**
 * The group state, telling the automatic backups of each change once it is stored. The state
 * itself is not changed: a backup reads every window, so it runs later, not inside a write.
 */
export function withBackupOnChange(
  inner: GroupState,
  backup: Pick<AutoBackup, 'changed'>,
): GroupState {
  const told = async (write: Promise<void>): Promise<void> => {
    await write;
    backup.changed();
  };

  return {
    ...inner,
    setGroups: (windowId, groups) => told(inner.setGroups(windowId, groups)),
    setActiveGroup: (windowId, groupId) =>
      told(inner.setActiveGroup(windowId, groupId)),
    setGroupIndex: (windowId, index) =>
      told(inner.setGroupIndex(windowId, index)),
    setTabGroup: (tabId, groupId) => told(inner.setTabGroup(tabId, groupId)),
    clearTabGroup: (tabId) => told(inner.clearTabGroup(tabId)),
  };
}
