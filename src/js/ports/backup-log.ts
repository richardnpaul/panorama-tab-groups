/** Where the automatic backups have got to */
export interface BackupRecord {
  /** The number of the file the next backup is written to, from 1 */
  next: number;
  /** When the last backup was written, in milliseconds since the epoch; none before the first */
  last: number | undefined;
}

/** What is kept of the automatic backups between runs of the background */
export interface BackupLog {
  /** The record; a first backup's (file 1, none written) when nothing is stored */
  read(): Promise<BackupRecord>;
  write(record: BackupRecord): Promise<void>;
}
