import { parseBackup } from '../core/backup.js';
import type { I18n } from '../ports/i18n.js';
import type { BackupService } from './backup-service.js';

/** A file the user chose */
export interface ChosenFile {
  type: string;
  text: () => Promise<string>;
}

export interface BackupControlsDeps {
  service: Pick<BackupService, 'open' | 'save'>;
  i18n: Pick<I18n, 'getMessage'>;
  // Tell the user something
  notify: (message: string) => void;
}

export interface BackupControls {
  /** Open the backup in the file the user chose; tell them if it is not one */
  openFile: (file: ChosenFile | undefined) => Promise<void>;
  save: () => Promise<void>;
}

export function createBackupControls({
  service,
  i18n,
  notify,
}: BackupControlsDeps): BackupControls {
  return {
    async openFile(file) {
      const backup =
        file?.type === 'application/json'
          ? parseBackup(await file.text())
          : undefined;

      if (backup === undefined) {
        notify(i18n.getMessage('optionsBackupInvalidFile'));
        return;
      }
      await service.open(backup);
    },

    save: () => service.save(),
  };
}
