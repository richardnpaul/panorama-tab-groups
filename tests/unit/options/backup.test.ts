// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type {
  BackupControls,
  ChosenFile,
} from '../../../src/js/app/backup-controls.js';
import { createBackupHandlers } from '../../../src/js/options/backup.js';

function setUp() {
  const openFile = vi.fn<(file: ChosenFile | undefined) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const save = vi.fn(() => Promise.resolve());
  const controls: BackupControls = { openFile, save };
  return { handlers: createBackupHandlers(controls), openFile, save };
}

const inputWith = (files: File[]): HTMLInputElement => {
  const input = document.createElement('input');
  input.type = 'file';
  Object.defineProperty(input, 'files', {
    value: Object.assign([...files], {
      item: (index: number) => files[index] ?? null,
    }),
  });
  return input;
};

const changeOf = (target: EventTarget): Event => {
  const event = new Event('change');
  Object.defineProperty(event, 'target', { value: target });
  return event;
};

describe('options/backup.ts', () => {
  describe('loadBackup', () => {
    it('opens the first file chosen in the input', async () => {
      const { handlers, openFile } = setUp();
      const first = new File(['{}'], 'a.json', { type: 'application/json' });
      const second = new File(['{}'], 'b.json', { type: 'application/json' });

      await handlers.loadBackup(changeOf(inputWith([first, second])));

      expect(openFile).toHaveBeenCalledTimes(1);
      expect(openFile).toHaveBeenCalledWith(first);
    });

    it('opens nothing when no file was chosen', async () => {
      const { handlers, openFile } = setUp();

      await handlers.loadBackup(changeOf(inputWith([])));

      expect(openFile).toHaveBeenCalledWith(undefined);
    });

    it('opens nothing when the input has no list of files', async () => {
      const { handlers, openFile } = setUp();

      await handlers.loadBackup(changeOf(document.createElement('input')));

      expect(openFile).toHaveBeenCalledWith(undefined);
    });

    it('opens nothing when the event is not from an input', async () => {
      const { handlers, openFile } = setUp();

      await handlers.loadBackup(changeOf(document.createElement('div')));

      expect(openFile).toHaveBeenCalledWith(undefined);
    });

    it('opens nothing when the event has no target', async () => {
      const { handlers, openFile } = setUp();

      await handlers.loadBackup(new Event('change'));

      expect(openFile).toHaveBeenCalledWith(undefined);
    });

    it('waits for the backup to open', async () => {
      const { handlers, openFile } = setUp();
      openFile.mockRejectedValueOnce(new Error('cannot open'));

      await expect(handlers.loadBackup(new Event('change'))).rejects.toThrow(
        'cannot open',
      );
    });
  });

  describe('saveBackup', () => {
    it('saves a backup', async () => {
      const { handlers, save } = setUp();

      await handlers.saveBackup();

      expect(save).toHaveBeenCalledTimes(1);
    });
  });
});
