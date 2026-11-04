import type { BackupFiles } from '../../ports/backup-files.js';
import type { Logger } from '../../ports/logger.js';

/** What the browser says changed about a download */
interface DownloadDelta {
  id: number;
  state?: { current?: string | undefined } | undefined;
  error?: { current?: string | undefined } | undefined;
}

type DeltaListener = (delta: DownloadDelta) => void;

/** The part of `browser.downloads` the background writes its files with */
export interface BackupFilesApi {
  downloads: {
    download(options: {
      url: string;
      filename: string;
      conflictAction: 'overwrite';
      saveAs: boolean;
    }): Promise<number>;
    search(query: {
      id: number;
    }): Promise<{ state?: string | undefined; error?: string | undefined }[]>;
    erase(query: { id: number }): Promise<unknown>;
    cancel(id: number): Promise<void>;
    onChanged: {
      addListener(listener: DeltaListener): void;
      removeListener(listener: DeltaListener): void;
    };
  };
}

/** Links to a text, which the browser can download */
export interface TextLinks {
  make(content: string): string;
  /** The link is no longer needed */
  release(url: string): void;
}

/** What the runtime has of `URL` to make a link to something in memory */
interface ObjectUrls {
  createObjectURL?: ((blob: Blob) => string) | undefined;
  revokeObjectURL?: ((url: string) => void) | undefined;
}

/**
 * A link to the text in memory where the runtime can make one: Firefox refuses to download a
 * `data:` address. Otherwise the text is in the address itself: Chromium's service worker has no
 * `URL.createObjectURL` (both found in `tests/e2e/*-backup-files.spec.ts`).
 */
export function textLinksOf({
  createObjectURL,
  revokeObjectURL,
}: ObjectUrls): TextLinks {
  if (createObjectURL === undefined || revokeObjectURL === undefined) {
    return {
      make: (content) =>
        `data:application/json;charset=utf-8,${encodeURIComponent(content)}`,
      release: () => undefined,
    };
  }
  return {
    make: (content) =>
      createObjectURL(new Blob([content], { type: 'application/json' })),
    release: (url) => {
      revokeObjectURL(url);
    },
  };
}

/** How a download ended */
interface End {
  state: string;
  error: string | undefined;
}

/** How a download ended, or nothing while it is going or not known yet */
const endOf = (
  state: string | undefined,
  error: string | undefined,
): End | undefined =>
  state === undefined || state === 'in_progress' ? undefined : { state, error };

/**
 * Rejects once `stop` is aborted, and cancels the download then; never settles otherwise. The
 * listener goes with the signal, which is made for one write.
 */
function givenUp(
  api: BackupFilesApi,
  id: number,
  stop: AbortSignal | undefined,
): Promise<never> {
  return new Promise((_resolve, reject) => {
    const giveUp = (): void => {
      reject(new Error('The file was not written: it was given up on'));
      // A download that is over cannot be cancelled, and there is nothing left of it to cancel
      api.downloads.cancel(id).catch(() => undefined);
    };
    if (stop?.aborted === true) {
      giveUp();
    } else {
      stop?.addEventListener('abort', giveUp);
    }
  });
}

/**
 * Settles when the download is complete, and rejects when it ends any other way, or when `stop`
 * is aborted: the listener is let go of either way
 */
async function finished(
  api: BackupFilesApi,
  id: number,
  stop: AbortSignal | undefined,
): Promise<void> {
  const { downloads } = api;
  const listening: DeltaListener[] = [];
  try {
    const ended = new Promise<End>((resolve, reject) => {
      const listener: DeltaListener = (delta) => {
        const end = endOf(delta.state?.current, delta.error?.current);
        if (delta.id === id && end !== undefined) {
          resolve(end);
        }
      };
      listening.push(listener);
      downloads.onChanged.addListener(listener);
      // It may have ended before the listener was there
      downloads.search({ id }).then(([item]) => {
        const end = endOf(item?.state, item?.error);
        if (end !== undefined) {
          resolve(end);
        }
      }, reject);
    });
    const { state, error } = await Promise.race([
      givenUp(api, id, stop),
      ended,
    ]);
    if (state !== 'complete') {
      throw new Error(`The file was not written: ${error ?? state}`);
    }
  } finally {
    listening.forEach((listener) => {
      downloads.onChanged.removeListener(listener);
    });
  }
}

export function createBrowserBackupFiles(
  getApi: () => BackupFilesApi,
  links: TextLinks,
  logger: Pick<Logger, 'warn'>,
): BackupFiles {
  return {
    async write(content, path, stop) {
      const api = getApi();
      const url = links.make(content);
      try {
        // Nothing is asked: a browser set to ask where to save every file would ask each time
        const id = await api.downloads.download({
          url,
          filename: path,
          conflictAction: 'overwrite',
          saveAs: false,
        });
        await finished(api, id, stop);
        // The file stays; only the browser's list of downloads forgets it. The file is written
        // whether it does or not.
        await api.downloads.erase({ id }).catch((error: unknown) => {
          logger.warn(
            '[AutoBackup] The file was written, but is left in the list of downloads:',
            error,
          );
        });
      } finally {
        links.release(url);
      }
    },
  };
}
