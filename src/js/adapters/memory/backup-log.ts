import type { BackupLog, BackupRecord } from '../../ports/backup-log.js';

/** A record kept in memory, which starts as the given one */
export function createMemoryBackupLog(
  initial: BackupRecord = { next: 1, last: undefined },
): BackupLog {
  let record = { ...initial };

  return {
    read: () => Promise.resolve({ ...record }),
    write(next) {
      record = { ...next };
      return Promise.resolve();
    },
  };
}
