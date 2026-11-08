import { describe, expect, it, vi } from 'vitest';
import {
  type BackupFilesApi,
  createBrowserBackupFiles,
  textLinksOf,
} from '../../../../src/js/adapters/browser/backup-files.js';
import { createBrowserBackupLog } from '../../../../src/js/adapters/browser/backup-log.js';
import { createBrowserPendingUpdate } from '../../../../src/js/adapters/browser/pending-update.js';
import { createBrowserDataVersion } from '../../../../src/js/adapters/browser/data-version.js';

type Delta = Parameters<
  Parameters<BackupFilesApi['downloads']['onChanged']['addListener']>[0]
>[0];

/** The browser's downloads, where each download ends as the test says, when it says */
function fakeDownloads({
  searched = [{ state: 'in_progress' }],
}: { searched?: { state?: string; error?: string }[] } = {}) {
  const listeners = new Set<(delta: Delta) => void>();
  const api = {
    downloads: {
      download: vi.fn().mockResolvedValue(7),
      search: vi.fn().mockResolvedValue(searched),
      erase: vi.fn().mockResolvedValue([7]),
      cancel: vi.fn().mockResolvedValue(undefined),
      onChanged: {
        addListener: vi.fn((listener: (delta: Delta) => void) => {
          listeners.add(listener);
        }),
        removeListener: vi.fn((listener: (delta: Delta) => void) => {
          listeners.delete(listener);
        }),
      },
    },
  } satisfies BackupFilesApi;
  const fire = (delta: Delta) => {
    [...listeners].forEach((listener) => {
      listener(delta);
    });
  };
  return { api, listeners, fire };
}

const quiet = () => ({ warn: vi.fn() });

const links = () => ({
  make: vi.fn(() => 'blob:link'),
  release: vi.fn(),
});

// Lets what has been started run as far as it can
const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

describe('adapters/browser/backup-files.ts', () => {
  it('writes the text to the path, replacing a file of that name, without asking', async () => {
    const { api, fire } = fakeDownloads();
    const made = links();
    const files = createBrowserBackupFiles(() => api, made, quiet());

    const written = files.write('{"a":1}', 'folder/backup-1.json');
    await settle();
    fire({ id: 7, state: { current: 'complete' } });
    await written;

    expect(made.make).toHaveBeenCalledWith('{"a":1}');
    expect(api.downloads.download).toHaveBeenCalledTimes(1);
    expect(api.downloads.download).toHaveBeenCalledWith({
      url: 'blob:link',
      filename: 'folder/backup-1.json',
      conflictAction: 'overwrite',
      saveAs: false,
    });
  });

  it('settles only once the file is complete, then takes it out of the list of downloads', async () => {
    const { api, fire } = fakeDownloads();
    const made = links();
    const files = createBrowserBackupFiles(() => api, made, quiet());
    let done = false;

    const written = files.write('a', 'b').then(() => {
      done = true;
    });
    await settle();
    // Another download, and this one still going, do not end it
    fire({ id: 3, state: { current: 'complete' } });
    fire({ id: 7, state: { current: 'in_progress' } });
    fire({ id: 7 });
    await settle();

    expect(done).toBe(false);
    expect(api.downloads.erase).not.toHaveBeenCalled();
    expect(made.release).not.toHaveBeenCalled();

    fire({ id: 7, state: { current: 'complete' } });
    await written;

    expect(api.downloads.erase).toHaveBeenCalledTimes(1);
    expect(api.downloads.erase).toHaveBeenCalledWith({ id: 7 });
    expect(made.release).toHaveBeenCalledWith('blob:link');
  });

  it('does not wait for a download that ended before it listened', async () => {
    const { api, listeners } = fakeDownloads({
      searched: [{ state: 'complete' }],
    });
    const files = createBrowserBackupFiles(() => api, links(), quiet());

    await files.write('a', 'b');

    expect(api.downloads.search).toHaveBeenCalledWith({ id: 7 });
    expect(api.downloads.erase).toHaveBeenCalledWith({ id: 7 });
    // It stops listening once it has its answer
    expect(listeners.size).toBe(0);
  });

  it('waits for a download the browser does not list yet', async () => {
    const { api, fire } = fakeDownloads({ searched: [] });
    const files = createBrowserBackupFiles(() => api, links(), quiet());

    const written = files.write('a', 'b');
    await settle();
    fire({ id: 7, state: { current: 'complete' } });

    await expect(written).resolves.toBeUndefined();
  });

  it('fails when the download ends without the file, and says why', async () => {
    const { api, fire, listeners } = fakeDownloads();
    const made = links();
    const files = createBrowserBackupFiles(() => api, made, quiet());

    const written = files.write('a', 'b');
    await settle();
    fire({
      id: 7,
      state: { current: 'interrupted' },
      error: { current: 'FILE_NO_SPACE' },
    });

    await expect(written).rejects.toThrow(
      'The file was not written: FILE_NO_SPACE',
    );
    expect(api.downloads.erase).not.toHaveBeenCalled();
    expect(made.release).toHaveBeenCalledWith('blob:link');
    expect(listeners.size).toBe(0);
  });

  it('says how it ended where the browser gives no reason', async () => {
    const { api } = fakeDownloads({ searched: [{ state: 'interrupted' }] });
    const files = createBrowserBackupFiles(() => api, links(), quiet());

    await expect(files.write('a', 'b')).rejects.toThrow(
      'The file was not written: interrupted',
    );
  });

  it('fails, and stops listening, when the browser cannot be asked about the download', async () => {
    const { api, listeners } = fakeDownloads();
    const failure = new Error('no such download');
    api.downloads.search.mockRejectedValue(failure);
    const files = createBrowserBackupFiles(() => api, links(), quiet());

    await expect(files.write('a', 'b')).rejects.toBe(failure);
    expect(listeners.size).toBe(0);
  });

  it('passes on a refused download, and lets go of the link', async () => {
    const { api } = fakeDownloads();
    const failure = new Error('Access denied');
    api.downloads.download.mockRejectedValue(failure);
    const made = links();
    const files = createBrowserBackupFiles(() => api, made, quiet());

    await expect(files.write('a', 'b')).rejects.toBe(failure);
    expect(made.release).toHaveBeenCalledWith('blob:link');
    expect(api.downloads.onChanged.addListener).not.toHaveBeenCalled();
  });

  it('counts a file as written that is left in the list of downloads, and says so', async () => {
    const { api } = fakeDownloads({ searched: [{ state: 'complete' }] });
    const failure = new Error('No such download');
    api.downloads.erase.mockRejectedValue(failure);
    const logger = quiet();
    const files = createBrowserBackupFiles(() => api, links(), logger);

    await expect(files.write('x', 'a.json')).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      '[AutoBackup] The file was written, but is left in the list of downloads:',
      failure,
    );
  });

  it('cancels a download it is told to stop waiting for, and leaves nothing of it behind', async () => {
    const { api, listeners } = fakeDownloads();
    const made = links();
    const files = createBrowserBackupFiles(() => api, made, quiet());
    const stopping = new AbortController();

    const written = files.write('x', 'a.json', stopping.signal);
    await settle();
    expect(listeners.size).toBe(1);
    stopping.abort();

    await expect(written).rejects.toThrow(
      new Error('The file was not written: it was given up on'),
    );
    expect(api.downloads.cancel).toHaveBeenCalledWith(7);
    expect(listeners.size).toBe(0);
    expect(made.release).toHaveBeenCalledWith('blob:link');
    expect(api.downloads.erase).not.toHaveBeenCalled();
  });

  it('gives up at once on a write it was told to stop before the download began, which a failed cancel does not change', async () => {
    const { api, listeners } = fakeDownloads();
    api.downloads.cancel.mockRejectedValue(
      new Error('Download must be in progress'),
    );
    const files = createBrowserBackupFiles(() => api, links(), quiet());
    const stopping = new AbortController();
    stopping.abort();

    await expect(files.write('x', 'a.json', stopping.signal)).rejects.toThrow(
      new Error('The file was not written: it was given up on'),
    );
    expect(listeners.size).toBe(0);
    expect(api.downloads.cancel).toHaveBeenCalledWith(7);
    expect(api.downloads.erase).not.toHaveBeenCalled();
  });

  it('uses the browser that exists when it is called', async () => {
    const first = fakeDownloads({ searched: [{ state: 'complete' }] });
    const second = fakeDownloads({ searched: [{ state: 'complete' }] });
    let current = first.api;
    const files = createBrowserBackupFiles(() => current, links(), quiet());
    current = second.api;

    await files.write('a', 'b');

    expect(first.api.downloads.download).not.toHaveBeenCalled();
    expect(second.api.downloads.download).toHaveBeenCalledTimes(1);
  });
});

describe('textLinksOf', () => {
  it('links to the text in memory where the runtime can, and lets go of it after', () => {
    const createObjectURL = vi.fn((blob: Blob) => {
      expect(blob.type).toBe('application/json');
      expect(blob.size).toBe(7);
      return 'blob:made';
    });
    const revokeObjectURL = vi.fn();
    const made = textLinksOf({ createObjectURL, revokeObjectURL });

    expect(made.make('{"a":1}')).toBe('blob:made');
    made.release('blob:made');

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:made');
  });

  it('puts the text in the address itself where the runtime cannot link to memory', async () => {
    const made = textLinksOf({});

    const url = made.make('{"a":"b c"}');

    expect(url).toBe(
      'data:application/json;charset=utf-8,%7B%22a%22%3A%22b%20c%22%7D',
    );
    await expect((await fetch(url)).text()).resolves.toBe('{"a":"b c"}');
    // There is nothing to let go of
    made.release(url);
  });

  it('does not link to memory it could not let go of', () => {
    const createObjectURL = vi.fn(() => 'blob:made');

    const url = textLinksOf({ createObjectURL }).make('a');

    expect(url).toBe('data:application/json;charset=utf-8,a');
    expect(createObjectURL).not.toHaveBeenCalled();
  });
});

describe('adapters/browser/backup-log.ts', () => {
  const storage = (stored: unknown) => {
    const set = vi.fn().mockResolvedValue(undefined);
    const get = vi
      .fn()
      .mockResolvedValue(
        stored === undefined ? {} : { automaticBackups: stored },
      );
    return { api: { storage: { local: { get, set } } }, get, set };
  };

  it('reads the record of the automatic backups', async () => {
    const { api, get } = storage({ next: 3, last: 1234 });

    await expect(createBrowserBackupLog(() => api).read()).resolves.toEqual({
      next: 3,
      last: 1234,
    });
    expect(get).toHaveBeenCalledWith('automaticBackups');
  });

  it('starts at the first file, with none written, when nothing is stored', async () => {
    const { api } = storage(undefined);

    await expect(createBrowserBackupLog(() => api).read()).resolves.toEqual({
      next: 1,
      last: undefined,
    });
  });

  it.each([
    ['not a record', 'text'],
    ['no file number', { last: 5 }],
    ['a file number below 1', { next: 0, last: 5 }],
    ['a file number that is not whole', { next: 1.5, last: 5 }],
    ['a file number as text', { next: '2', last: 5 }],
    ['a file number past the last file', { next: 6, last: 5 }],
  ])('starts at the first file for %s', async (_, stored) => {
    const { api } = storage(stored);

    const { next } = await createBrowserBackupLog(() => api).read();

    expect(next).toBe(1);
  });

  it.each([1, 5])(
    'keeps the file number %i, which is a file of the ring',
    async (next) => {
      const { api } = storage({ next, last: 5 });

      await expect(createBrowserBackupLog(() => api).read()).resolves.toEqual({
        next,
        last: 5,
      });
    },
  );

  it('reads a time that is not a number as no backup written', async () => {
    const { api } = storage({ next: 2, last: '1234' });

    await expect(createBrowserBackupLog(() => api).read()).resolves.toEqual({
      next: 2,
      last: undefined,
    });
  });

  it('stores the record under its key', async () => {
    const { api, set } = storage(undefined);

    await createBrowserBackupLog(() => api).write({ next: 4, last: 99 });

    expect(set).toHaveBeenCalledWith({
      automaticBackups: { next: 4, last: 99 },
    });
  });
});

describe('adapters/browser/data-version.ts', () => {
  const storage = (items: Record<string, unknown>) => {
    const set = vi.fn().mockResolvedValue(undefined);
    const get = vi.fn().mockResolvedValue(items);
    return { api: { storage: { local: { get, set } } }, get, set };
  };

  it('reads the version of the stored data', async () => {
    const { api, get } = storage({ schemaVersion: 2 });

    await expect(createBrowserDataVersion(() => api).read()).resolves.toBe(2);
    expect(get).toHaveBeenCalledWith('schemaVersion');
  });

  it('reads the first version, which is one', async () => {
    const { api } = storage({ schemaVersion: 1 });

    await expect(createBrowserDataVersion(() => api).read()).resolves.toBe(1);
  });

  it.each([
    {},
    { schemaVersion: '2' },
    { schemaVersion: null },
    { schemaVersion: 0 },
    { schemaVersion: -1 },
    { schemaVersion: 2.5 },
    { schemaVersion: Number.POSITIVE_INFINITY },
  ])('has none where none is stored, or something else (%j)', async (items) => {
    const { api } = storage(items);

    await expect(
      createBrowserDataVersion(() => api).read(),
    ).resolves.toBeUndefined();
  });

  it('stores the version under its key', async () => {
    const { api, set } = storage({});

    await createBrowserDataVersion(() => api).write(2);

    expect(set).toHaveBeenCalledWith({ schemaVersion: 2 });
  });
});

describe('adapters/browser/pending-update.ts', () => {
  const area = (stored: Record<string, unknown> = {}) => ({
    get: vi.fn().mockResolvedValue(stored),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  });

  it('is pending when the flag is stored in the session, and asks for that key alone', async () => {
    const session = area({ updatePending: 1 });
    const pending = createBrowserPendingUpdate(() => ({
      storage: { session },
    }));

    await expect(pending.isPending()).resolves.toBe(true);

    expect(session.get).toHaveBeenCalledWith(['updatePending']);
  });

  it.each([{}, { updatePending: 0 }, { updatePending: true }])(
    'is not pending where the flag is not stored, or is something else (%j)',
    async (stored) => {
      const pending = createBrowserPendingUpdate(() => ({
        storage: { session: area(stored) },
      }));

      await expect(pending.isPending()).resolves.toBe(false);
    },
  );

  it('stores the flag, and removes it', async () => {
    const session = area();
    const pending = createBrowserPendingUpdate(() => ({
      storage: { session },
    }));

    await pending.set(true);
    await pending.set(false);

    expect(session.set).toHaveBeenCalledWith({ updatePending: 1 });
    expect(session.remove).toHaveBeenCalledWith(['updatePending']);
  });

  it.each([undefined, {}])(
    'is never pending in a browser without a session storage, and sets nothing (%j)',
    async (storage) => {
      const pending = createBrowserPendingUpdate(() => ({ storage }));

      await expect(pending.isPending()).resolves.toBe(false);
      await expect(pending.set(true)).resolves.toBeUndefined();
      await expect(pending.set(false)).resolves.toBeUndefined();
    },
  );
});
