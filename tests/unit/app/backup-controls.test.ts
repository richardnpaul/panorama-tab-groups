import { describe, expect, it, vi } from 'vitest';
import { createBackupControls } from '../../../src/js/app/backup-controls.js';

const validBackup = JSON.stringify({
  file: { type: 'tgvView', version: 1 },
  windows: [],
});

function setUp() {
  const service = {
    open: vi.fn().mockResolvedValue(undefined),
    save: vi.fn().mockResolvedValue(undefined),
  };
  const notify = vi.fn();
  return {
    controls: createBackupControls({ service, notify }),
    service,
    notify,
  };
}

const file = (type: string, text: string) => ({
  type,
  text: () => Promise.resolve(text),
});

describe('app/backup-controls.ts', () => {
  describe('openFile', () => {
    it('opens the backup in a file of JSON', async () => {
      const { controls, service, notify } = setUp();

      await controls.openFile(file('application/json', validBackup));

      expect(service.open).toHaveBeenCalledTimes(1);
      expect(service.open).toHaveBeenCalledWith({
        file: { type: 'tgvView', version: 1 },
        windows: [],
      });
      expect(notify).not.toHaveBeenCalled();
    });

    it.each([
      ['a file of another type', file('text/plain', validBackup)],
      ['a file with no type', file('', validBackup)],
      ['a file that is not a backup', file('application/json', '{"a":1}')],
      ['a file that is not JSON', file('application/json', 'nope')],
      ['no file', undefined],
    ])(
      'says the file is invalid for %s, and opens nothing',
      async (_name, chosen) => {
        const { controls, service, notify } = setUp();

        await controls.openFile(chosen);

        expect(notify).toHaveBeenCalledTimes(1);
        expect(notify).toHaveBeenCalledWith('Invalid file');
        expect(service.open).not.toHaveBeenCalled();
      },
    );

    it('does not read a file of another type', async () => {
      const { controls } = setUp();
      const text = vi.fn().mockResolvedValue(validBackup);

      await controls.openFile({ type: 'text/plain', text });

      expect(text).not.toHaveBeenCalled();
    });

    it('passes on a failure to open', async () => {
      const { controls, service } = setUp();
      const failure = new Error('no windows');
      service.open.mockRejectedValue(failure);

      await expect(
        controls.openFile(file('application/json', validBackup)),
      ).rejects.toBe(failure);
    });
  });

  describe('save', () => {
    it('saves a backup', async () => {
      const { controls, service } = setUp();

      await controls.save();

      expect(service.save).toHaveBeenCalledTimes(1);
    });

    it('passes on a failure', async () => {
      const { controls, service } = setUp();
      const failure = new Error('cancelled');
      service.save.mockRejectedValue(failure);

      await expect(controls.save()).rejects.toBe(failure);
    });
  });
});
