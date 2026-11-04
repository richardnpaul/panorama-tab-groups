import { describe, expect, it } from 'vitest';
import { createMemoryBackupFiles } from '../../../../src/js/adapters/memory/backup-files.js';
import { createMemoryBackupLog } from '../../../../src/js/adapters/memory/backup-log.js';
import { createMemoryPendingUpdate } from '../../../../src/js/adapters/memory/pending-update.js';
import { createMemoryDataVersion } from '../../../../src/js/adapters/memory/data-version.js';

describe('adapters/memory/backup-files.ts', () => {
  it('keeps the last text written to each path, and the paths in order', async () => {
    const files = createMemoryBackupFiles();

    await files.write('one', 'a.json');
    await files.write('two', 'b.json');
    await files.write('three', 'a.json');

    expect(Object.fromEntries(files.files)).toEqual({
      'a.json': 'three',
      'b.json': 'two',
    });
    expect(files.written).toEqual(['a.json', 'b.json', 'a.json']);
  });

  it('fails while it is told to, and writes nothing then', async () => {
    const files = createMemoryBackupFiles();
    const failure = new Error('disk full');

    files.failWith(failure);
    await expect(files.write('one', 'a.json')).rejects.toBe(failure);
    expect(files.written).toEqual([]);

    files.failWith(undefined);
    await files.write('two', 'a.json');
    expect(files.files.get('a.json')).toBe('two');
  });
});

describe('adapters/memory/backup-log.ts', () => {
  it('starts at the first file, with none written', async () => {
    await expect(createMemoryBackupLog().read()).resolves.toEqual({
      next: 1,
      last: undefined,
    });
  });

  it('gives back what was written, and not the object itself', async () => {
    const initial = { next: 2, last: 10 };
    const log = createMemoryBackupLog(initial);
    initial.next = 9;

    const read = await log.read();
    read.next = 8;
    expect(await log.read()).toEqual({ next: 2, last: 10 });

    const written = { next: 3, last: 20 };
    await log.write(written);
    written.next = 7;
    expect(await log.read()).toEqual({ next: 3, last: 20 });
  });
});

describe('adapters/memory/data-version.ts', () => {
  it('has no version until one is written, or the one it was given', async () => {
    const version = createMemoryDataVersion();

    await expect(version.read()).resolves.toBeUndefined();
    await version.write(2);
    await expect(version.read()).resolves.toBe(2);
    await expect(createMemoryDataVersion(5).read()).resolves.toBe(5);
  });

  it.each([0, 1.5, Number.NaN])(
    'reads %d back as no version, as the browser does',
    async (stored) => {
      await expect(
        createMemoryDataVersion(stored).read(),
      ).resolves.toBeUndefined();
    },
  );
});

describe('adapters/memory/pending-update.ts', () => {
  it('is not pending until it is set, or the one it was given', async () => {
    const pending = createMemoryPendingUpdate();

    await expect(pending.isPending()).resolves.toBe(false);
    await pending.set(true);
    await expect(pending.isPending()).resolves.toBe(true);
    await pending.set(false);
    await expect(pending.isPending()).resolves.toBe(false);
    await expect(createMemoryPendingUpdate(true).isPending()).resolves.toBe(
      true,
    );
  });

  it('fails while it is told to', async () => {
    const pending = createMemoryPendingUpdate();
    const failure = new Error('gone');

    pending.failWith(failure);

    await expect(pending.isPending()).rejects.toBe(failure);
    await expect(pending.set(true)).rejects.toBe(failure);
  });
});
