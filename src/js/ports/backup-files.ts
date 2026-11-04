/** Files the background writes on its own, without asking the user */
export interface BackupFiles {
  /**
   * Write text to a file at a path under the user's Downloads folder, replacing a file of that
   * name, and settle once it is written. Rejects if the browser refuses or the file is not
   * written. The browser's list of downloads keeps no entry of it. Once `stop` is aborted (while
   * the write waits; it is made for one write), the download is cancelled and the write rejects,
   * leaving nothing of it behind.
   */
  write(content: string, path: string, stop?: AbortSignal): Promise<void>;
}
