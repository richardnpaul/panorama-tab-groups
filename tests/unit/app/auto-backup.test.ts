import { describe, expect, it, vi } from 'vitest';
import { createMemoryBackupFiles } from '../../../src/js/adapters/memory/backup-files.js';
import { createMemoryBackupLog } from '../../../src/js/adapters/memory/backup-log.js';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import {
  autoBackupPath,
  createAutoBackup,
  withBackupOnChange,
} from '../../../src/js/app/auto-backup.js';
import { AUTO_BACKUP_WRITE_MS } from '../../../src/js/core/constants.js';
import type { Backup } from '../../../src/js/core/backup.js';
import type { BackupRecord } from '../../../src/js/ports/backup-log.js';
import type { GroupState } from '../../../src/js/ports/group-state.js';

const HOUR = 60 * 60 * 1000;
const QUIET = 5000;
// 2026-11-03 at noon, UTC
const NOON = Date.UTC(2026, 10, 3, 12);

const backup = (activeGroup: number): Backup => ({
  file: { type: 'tgvView', version: 1 },
  windows: [
    {
      groups: [],
      tabs: [],
      activeGroup,
      groupIndex: 1,
      position: undefined,
    },
  ],
});

function setUp({
  record,
  openingBackup = false,
}: { record?: BackupRecord; openingBackup?: boolean } = {}) {
  const files = createMemoryBackupFiles();
  const log = createMemoryBackupLog(record);
  const clock = createMemoryClock(NOON);
  const scheduler = createMemoryScheduler();
  let shown = 1;
  const snapshot = vi.fn(() => Promise.resolve(backup(shown)));
  const opening = { now: openingBackup };
  const logger = { debug: vi.fn(), error: vi.fn() };
  const autoBackup = createAutoBackup({
    snapshot,
    files,
    log,
    clock,
    scheduler,
    isOpeningBackup: () => opening.now,
    logger,
  });
  return {
    autoBackup,
    files,
    log,
    clock,
    scheduler,
    snapshot,
    opening,
    logger,
    show: (group: number) => {
      shown = group;
    },
    /** Time passes, and what the timers started is done */
    async wait(ms: number) {
      clock.advance(ms);
      scheduler.advance(ms);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
    },
  };
}

const parsed = (text: string | undefined): unknown =>
  JSON.parse(text ?? 'null');

describe('app/auto-backup.ts', () => {
  describe('autoBackupPath', () => {
    it('is the numbered file in the folder of the backups', () => {
      expect(autoBackupPath(3)).toBe(
        'panorama-tab-groups-backups/backup-3.json',
      );
    });
  });

  describe('writeIfDue', () => {
    it('writes a backup when none was written within the hour', async () => {
      const env = setUp({ record: { next: 3, last: NOON - HOUR } });

      await expect(env.autoBackup.writeIfDue('before')).resolves.toBe(true);

      expect(env.files.written).toEqual([autoBackupPath(3)]);
    });

    it('writes none, and says it has one, when one was written within the hour', async () => {
      const env = setUp({ record: { next: 3, last: NOON - HOUR + 1 } });

      await expect(env.autoBackup.writeIfDue('before')).resolves.toBe(true);

      expect(env.files.written).toEqual([]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[AutoBackup] No backup (before): the last is less than an hour old',
      );
    });

    it('writes one, and says so, when it cannot tell when the last was', async () => {
      const env = setUp();
      const failure = new Error('storage gone');
      vi.spyOn(env.log, 'read')
        .mockRejectedValueOnce(failure)
        .mockResolvedValue({ next: 1, last: undefined });

      await expect(env.autoBackup.writeIfDue('before')).resolves.toBe(true);

      expect(env.files.written).toEqual([autoBackupPath(1)]);
      expect(env.logger.error).toHaveBeenCalledWith(
        '[AutoBackup] Could not tell when the last backup was:',
        failure,
      );
    });

    it('writes only the first when asked twice at once and none was written within the hour', async () => {
      const env = setUp({ record: { next: 3, last: NOON - HOUR } });

      const results = await Promise.all([
        env.autoBackup.writeIfDue('first'),
        env.autoBackup.writeIfDue('second'),
      ]);

      expect(results).toEqual([true, true]);
      expect(env.files.written).toEqual([autoBackupPath(3)]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[AutoBackup] No backup (second): the last is less than an hour old',
      );
    });
  });

  describe('writeNow', () => {
    it('writes the groups and tabs, with when, to the next file, and notes it', async () => {
      const env = setUp({ record: { next: 2, last: undefined } });

      await expect(env.autoBackup.writeNow('update')).resolves.toBe(true);

      expect(env.files.written).toEqual([
        'panorama-tab-groups-backups/backup-2.json',
      ]);
      const text = env.files.files.get(
        'panorama-tab-groups-backups/backup-2.json',
      );
      expect(parsed(text)).toEqual({
        ...backup(1),
        savedAt: '2026-11-03T12:00:00.000Z',
      });
      // Readable by a person, as the backups the user saves are
      expect(text).toContain('\n\t"file"');
      expect(await env.log.read()).toEqual({ next: 3, last: NOON });
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[AutoBackup] Wrote backup 2 (update)',
      );
    });

    it('goes back to the first file after the last, so only five are kept', async () => {
      const env = setUp({ record: { next: 5, last: undefined } });

      await env.autoBackup.writeNow('update');
      await env.autoBackup.writeNow('update');

      expect(env.files.written).toEqual([
        'panorama-tab-groups-backups/backup-5.json',
        'panorama-tab-groups-backups/backup-1.json',
      ]);
      expect((await env.log.read()).next).toBe(2);
    });

    it('writes one backup at a time, each to a file of its own', async () => {
      const env = setUp();

      const both = await Promise.all([
        env.autoBackup.writeNow('a'),
        env.autoBackup.writeNow('b'),
      ]);

      expect(both).toEqual([true, true]);
      expect(env.files.written).toEqual([
        'panorama-tab-groups-backups/backup-1.json',
        'panorama-tab-groups-backups/backup-2.json',
      ]);
    });

    it('logs a backup that failed, notes nothing, and goes on with the next', async () => {
      const env = setUp();
      const failure = new Error('disk full');
      env.files.failWith(failure);

      await expect(env.autoBackup.writeNow('update')).resolves.toBe(false);

      expect(env.logger.error).toHaveBeenCalledWith(
        '[AutoBackup] The backup (update) failed:',
        failure,
      );
      expect(await env.log.read()).toEqual({ next: 1, last: undefined });

      env.files.failWith(undefined);
      await expect(env.autoBackup.writeNow('again')).resolves.toBe(true);
      expect(env.files.written).toEqual([
        'panorama-tab-groups-backups/backup-1.json',
      ]);
    });

    it('gives up on a file that is not written within the time, says so, and goes on with the next', async () => {
      const env = setUp();
      let finish: () => void = () => undefined;
      let stop: AbortSignal | undefined;
      vi.spyOn(env.files, 'write').mockImplementationOnce(
        (_content, _path, given) =>
          new Promise<void>((resolve) => {
            stop = given;
            finish = resolve;
          }),
      );

      const first = env.autoBackup.writeNow('update');
      const second = env.autoBackup.writeNow('changes');
      // The first has begun, and its time with it
      await env.wait(0);
      await env.wait(AUTO_BACKUP_WRITE_MS - 1);
      expect(env.logger.error).not.toHaveBeenCalled();
      expect(stop?.aborted).toBe(false);
      await env.wait(1);
      // The write is told to stop, so that nothing of it is left waiting
      expect(stop?.aborted).toBe(true);

      await expect(first).resolves.toBe(false);
      await expect(second).resolves.toBe(true);
      expect(env.logger.error).toHaveBeenCalledWith(
        '[AutoBackup] The backup (update) failed:',
        new Error('The backup file was not written within 30 seconds'),
      );
      // Nothing was noted for the one that failed, and the next took its file
      expect(env.files.written).toEqual([autoBackupPath(1)]);
      expect(env.scheduler.pending()).toBe(0);
      finish();
    });

    it('does not give up on a file that is written in time', async () => {
      const env = setUp();

      await env.autoBackup.writeNow('update');
      await env.wait(AUTO_BACKUP_WRITE_MS * 2);

      expect(env.logger.error).not.toHaveBeenCalled();
      expect(env.scheduler.pending()).toBe(0);
    });

    it('leaves no timer of the time allowed behind for a file that failed', async () => {
      const env = setUp();
      env.files.failWith(new Error('disk full'));

      await env.autoBackup.writeNow('update');

      expect(env.scheduler.pending()).toBe(0);
    });

    it('passes on a file that fails to be written, as the error it is', async () => {
      const env = setUp();
      vi.spyOn(env.files, 'write').mockRejectedValueOnce('refused');

      await expect(env.autoBackup.writeNow('update')).resolves.toBe(false);

      expect(env.logger.error).toHaveBeenCalledWith(
        '[AutoBackup] The backup (update) failed:',
        new Error('refused'),
      );
    });

    it('fails without writing when the groups cannot be read', async () => {
      const env = setUp();
      env.snapshot.mockRejectedValueOnce(new Error('no window'));

      await expect(env.autoBackup.writeNow('update')).resolves.toBe(false);

      expect(env.files.written).toEqual([]);
    });
  });

  describe('changed', () => {
    it('backs nothing up before start-up has put the groups together', async () => {
      const env = setUp();

      env.autoBackup.changed();
      await env.wait(HOUR);

      expect(env.files.written).toEqual([]);
      expect(env.scheduler.pending()).toBe(0);
    });

    it('backs up a change made before start-up was done, once it is', async () => {
      const env = setUp();
      env.autoBackup.changed();

      env.autoBackup.start();
      await env.wait(QUIET);

      expect(env.files.written).toEqual([autoBackupPath(1)]);
    });

    it('starts with nothing to back up when nothing changed', async () => {
      const env = setUp();

      env.autoBackup.start();
      await env.wait(HOUR);

      expect(env.files.written).toEqual([]);
      expect(env.scheduler.pending()).toBe(0);
    });

    it('backs up a change once the groups have stayed unchanged for a few seconds', async () => {
      const env = setUp();
      env.autoBackup.start();

      env.autoBackup.changed();
      await env.wait(QUIET - 1);
      expect(env.files.written).toEqual([]);

      await env.wait(1);
      expect(env.files.written).toEqual([
        'panorama-tab-groups-backups/backup-1.json',
      ]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[AutoBackup] Wrote backup 1 (changes)',
      );
    });

    it('waits for the last of a run of changes, and backs them up once', async () => {
      const env = setUp();
      env.autoBackup.start();

      env.autoBackup.changed();
      await env.wait(QUIET - 1);
      env.show(2);
      env.autoBackup.changed();
      await env.wait(QUIET - 1);
      expect(env.files.written).toEqual([]);

      await env.wait(1);
      expect(env.files.written).toHaveLength(1);
      expect(env.snapshot).toHaveBeenCalledTimes(1);
      expect(parsed(env.files.files.get(autoBackupPath(1)))).toMatchObject({
        windows: [{ activeGroup: 2 }],
      });
      expect(env.scheduler.pending()).toBe(0);
    });

    it('does not back up again within the hour', async () => {
      // The last backup is a millisecond less than an hour old when the changes have settled
      const env = setUp({ record: { next: 2, last: NOON + QUIET - HOUR + 1 } });
      env.autoBackup.start();

      env.autoBackup.changed();
      await env.wait(QUIET);
      expect(env.files.written).toEqual([]);

      // Past the hour since the last, the next change is backed up
      await env.wait(HOUR);
      env.autoBackup.changed();
      await env.wait(QUIET);
      expect(env.files.written).toEqual([autoBackupPath(2)]);
    });

    it('backs up a change an hour, to the millisecond, after the last', async () => {
      const env = setUp({ record: { next: 2, last: NOON - HOUR + QUIET } });
      env.autoBackup.start();

      env.autoBackup.changed();
      await env.wait(QUIET);

      expect(env.files.written).toEqual([autoBackupPath(2)]);
    });

    it('backs up a change when the last backup is in the future, written while the clock was ahead', async () => {
      const env = setUp({ record: { next: 2, last: NOON + QUIET + 1 } });
      env.autoBackup.start();

      env.autoBackup.changed();
      await env.wait(QUIET);

      expect(env.files.written).toEqual([autoBackupPath(2)]);
    });

    it('does not back up again when the last backup was this very millisecond', async () => {
      const env = setUp({ record: { next: 2, last: NOON + QUIET } });
      env.autoBackup.start();

      env.autoBackup.changed();
      await env.wait(QUIET);

      expect(env.files.written).toEqual([]);
    });

    it('waits while a backup is being opened, whose tabs are still arriving', async () => {
      const env = setUp({ openingBackup: true });
      env.autoBackup.start();

      env.autoBackup.changed();
      await env.wait(QUIET * 3);
      expect(env.files.written).toEqual([]);
      expect(env.scheduler.pending()).toBe(1);

      env.opening.now = false;
      await env.wait(QUIET);
      expect(env.files.written).toEqual([autoBackupPath(1)]);
    });

    it('says once that it puts a backup off while a backup is being opened, and again for the next wait', async () => {
      const env = setUp({ openingBackup: true, record: { next: 1, last: 0 } });
      env.autoBackup.start();
      const said = () =>
        env.logger.debug.mock.calls.filter(
          ([text]) =>
            text ===
            '[AutoBackup] Put off while a backup is being opened, until it is',
        ).length;

      env.autoBackup.changed();
      await env.wait(QUIET * 3);
      expect(said()).toBe(1);

      env.opening.now = false;
      await env.wait(QUIET);
      env.opening.now = true;
      await env.wait(HOUR);
      env.autoBackup.changed();
      await env.wait(QUIET);
      expect(said()).toBe(2);
    });

    it('logs a record that cannot be read, and writes nothing', async () => {
      const env = setUp();
      const failure = new Error('storage gone');
      vi.spyOn(env.log, 'read').mockRejectedValue(failure);
      env.autoBackup.start();

      env.autoBackup.changed();
      await env.wait(QUIET);

      expect(env.files.written).toEqual([]);
      expect(env.logger.error).toHaveBeenCalledWith(
        '[AutoBackup] Could not tell when the last backup was:',
        failure,
      );
    });

    it('does not back up a change when another backup is being written as the quiet time ends', async () => {
      const env = setUp();
      env.autoBackup.start();
      let finishWrite: () => void = () => undefined;
      vi.spyOn(env.files, 'write').mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishWrite = resolve;
          }),
      );

      env.autoBackup.changed();
      const urgent = env.autoBackup.writeNow('update');
      await env.wait(QUIET);
      finishWrite();
      await urgent;
      await env.wait(0);

      expect(env.logger.debug.mock.calls).toEqual([
        ['[AutoBackup] Wrote backup 1 (update)'],
      ]);
    });
  });

  describe('withBackupOnChange', () => {
    const writes: [
      keyof GroupState,
      (state: GroupState) => Promise<void>,
      unknown[],
    ][] = [
      ['setGroups', (state) => state.setGroups(4, []), [4, []]],
      ['setActiveGroup', (state) => state.setActiveGroup(4, 2), [4, 2]],
      ['setGroupIndex', (state) => state.setGroupIndex(4, 3), [4, 3]],
      ['setTabGroup', (state) => state.setTabGroup(4, 2), [4, 2]],
      ['clearTabGroup', (state) => state.clearTabGroup(4), [4]],
    ];

    it.each(writes)(
      'tells of a change once %s has stored it, not before',
      async (name, call, args) => {
        let store: () => void = () => undefined;
        const write = vi.fn(
          () =>
            new Promise<void>((resolve) => {
              store = resolve;
            }),
        );
        const changed = vi.fn();
        const state = withBackupOnChange(
          { ...createMemoryGroupState(), [name]: write },
          { changed },
        );

        const done = call(state);
        await Promise.resolve();
        expect(write).toHaveBeenCalledWith(...args);
        expect(changed).not.toHaveBeenCalled();

        store();
        await done;
        expect(changed).toHaveBeenCalledTimes(1);
      },
    );

    it('stores what it is given, as the state it wraps', async () => {
      const inner = createMemoryGroupState();
      const state = withBackupOnChange(inner, { changed: vi.fn() });

      await state.setGroups(1, []);
      await state.setActiveGroup(1, 2);
      await state.setGroupIndex(1, 3);
      await state.setTabGroup(4, 2);
      await state.setTabGroup(5, 2);
      await state.clearTabGroup(5);

      await expect(state.getActiveGroup(1)).resolves.toBe(2);
      await expect(state.getGroupIndex(1)).resolves.toBe(3);
      await expect(state.getTabGroup(4)).resolves.toBe(2);
      await expect(state.getTabGroup(5)).resolves.toBeUndefined();
      await expect(state.getGroups(1)).resolves.toEqual([]);
    });

    it('tells of nothing when the write failed', async () => {
      const inner = createMemoryGroupState();
      const failure = new Error('quota');
      vi.spyOn(inner, 'setTabGroup').mockRejectedValue(failure);
      const changed = vi.fn();

      await expect(
        withBackupOnChange(inner, { changed }).setTabGroup(4, 2),
      ).rejects.toBe(failure);

      expect(changed).not.toHaveBeenCalled();
    });

    it('does not tell of reads', async () => {
      const changed = vi.fn();
      const state = withBackupOnChange(createMemoryGroupState(), { changed });

      await state.getGroups(1);
      await state.getActiveGroup(1);
      await state.getGroupIndex(1);
      await state.getTabGroup(1);

      expect(changed).not.toHaveBeenCalled();
    });
  });
});
