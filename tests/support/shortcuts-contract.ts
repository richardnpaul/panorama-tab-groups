import { beforeEach, describe, expect, it } from 'vitest';
import type { Shortcut, Shortcuts } from '../../src/js/ports/shortcuts.js';

/** What every Shortcuts must do; `create` starts with these commands as the extension's own */
export function describeShortcutsContract(
  name: string,
  create: (initial: Shortcut[]) => Shortcuts,
): void {
  describe(`Shortcuts contract: ${name}`, () => {
    let shortcuts: Shortcuts;

    beforeEach(() => {
      shortcuts = create([
        { name: 'first', shortcut: 'Ctrl+A' },
        { name: 'second', shortcut: '' },
      ]);
    });

    it('lists the commands with their keys, in order', async () => {
      await expect(shortcuts.getAll()).resolves.toEqual([
        { name: 'first', shortcut: 'Ctrl+A' },
        { name: 'second', shortcut: '' },
      ]);
    });

    it('changes the keys of one command', async () => {
      await shortcuts.update('second', 'Alt+2');

      await expect(shortcuts.getAll()).resolves.toEqual([
        { name: 'first', shortcut: 'Ctrl+A' },
        { name: 'second', shortcut: 'Alt+2' },
      ]);
    });

    it('goes back to the keys the command came with', async () => {
      await shortcuts.update('first', 'Alt+1');

      await shortcuts.reset('first');

      expect((await shortcuts.getAll())[0]).toEqual({
        name: 'first',
        shortcut: 'Ctrl+A',
      });
    });

    it('gives copies, so changing one does not change the commands', async () => {
      const [first] = await shortcuts.getAll();
      if (first !== undefined) {
        first.shortcut = 'changed';
      }

      expect((await shortcuts.getAll())[0]?.shortcut).toBe('Ctrl+A');
    });
  });
}
