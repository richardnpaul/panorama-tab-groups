import type { BackupFiles } from '../../ports/backup-files.js';

export interface MemoryBackupFiles extends BackupFiles {
  /** The files as they are now, by path */
  readonly files: Map<string, string>;
  /** The paths written, in order */
  readonly written: string[];
  /** Make every write from now on fail with this; `undefined` makes them work again */
  failWith(error: Error | undefined): void;
}

/** Files kept in memory, which a write replaces */
export function createMemoryBackupFiles(): MemoryBackupFiles {
  const files = new Map<string, string>();
  const written: string[] = [];
  let failure: Error | undefined;

  return {
    files,
    written,
    failWith(error) {
      failure = error;
    },
    write(content, path) {
      if (failure !== undefined) {
        return Promise.reject(failure);
      }
      files.set(path, content);
      written.push(path);
      return Promise.resolve();
    },
  };
}
