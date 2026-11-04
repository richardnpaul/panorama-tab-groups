import type { BackupLog, BackupRecord } from '../../ports/backup-log.js';
import { AUTO_BACKUP_COUNT } from '../../core/constants.js';
import { isNumber, isRecord } from '../../share/guards.js';

const KEY = 'automaticBackups';

/** The part of `browser.storage.local` the record lives in */
export interface BackupLogApi {
  storage: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, BackupRecord>): Promise<void>;
    };
  };
}

// A number of the ring of files: anything else is read as the first, so no stray file is written
const isFileNumber = (value: unknown): value is number =>
  isNumber(value) &&
  Number.isInteger(value) &&
  value > 0 &&
  value <= AUTO_BACKUP_COUNT;

/** What is stored, as a record; anything else is read as no backup written yet */
function recordOf(stored: unknown): BackupRecord {
  if (!isRecord(stored)) {
    return { next: 1, last: undefined };
  }
  return {
    next: isFileNumber(stored.next) ? stored.next : 1,
    last: isNumber(stored.last) ? stored.last : undefined,
  };
}

export function createBrowserBackupLog(getApi: () => BackupLogApi): BackupLog {
  return {
    async read() {
      return recordOf((await getApi().storage.local.get(KEY))[KEY]);
    },
    write: (record) => getApi().storage.local.set({ [KEY]: record }),
  };
}
