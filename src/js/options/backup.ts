import type { BackupControls } from '../app/backup-controls.js';

export interface BackupHandlers {
  /** Open the backup in the file chosen in the input that fired the event */
  loadBackup: (event: Event) => Promise<void>;
  saveBackup: () => Promise<void>;
}

/** The file the user chose in the input that fired the event */
function chosenFileOf(event: Event): File | undefined {
  const { target } = event;
  return target instanceof HTMLInputElement
    ? (target.files?.item(0) ?? undefined)
    : undefined;
}

export function createBackupHandlers(controls: BackupControls): BackupHandlers {
  return {
    loadBackup: (event) => controls.openFile(chosenFileOf(event)),
    saveBackup: controls.save,
  };
}
