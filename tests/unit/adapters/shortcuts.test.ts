import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserShortcuts,
  type CommandsApi,
} from '../../../src/js/adapters/browser/shortcuts.js';
import { createMemoryShortcuts } from '../../../src/js/adapters/memory/shortcuts.js';
import type { Shortcut } from '../../../src/js/ports/shortcuts.js';
import { describeShortcutsContract } from '../../support/shortcuts-contract.js';

interface Command {
  name?: string;
  shortcut?: string;
}

/** `browser.commands` as the browser has it: a reset goes back to the manifest's keys */
function fakeCommands(initial: readonly Command[]) {
  let commands = initial.map((command) => ({ ...command }));
  const update = vi.fn(
    ({ name, shortcut }: { name: string; shortcut: string }) => {
      commands = commands.map((command) =>
        command.name === name ? { name, shortcut } : command,
      );
      return Promise.resolve();
    },
  );
  const reset = vi.fn((name: string) => {
    commands = commands.map((command) =>
      command.name === name
        ? (initial.find((first) => first.name === name) ?? command)
        : command,
    );
    return Promise.resolve();
  });
  const api: CommandsApi = {
    commands: {
      getAll: () =>
        Promise.resolve(commands.map((command) => ({ ...command }))),
      update,
      reset,
    },
  };
  return { api, update, reset };
}

describeShortcutsContract('browser', (initial: Shortcut[]) => {
  const { api } = fakeCommands(initial);
  return createBrowserShortcuts(() => api);
});

describeShortcutsContract('memory', (initial) =>
  createMemoryShortcuts(initial),
);

describe('adapters/browser/shortcuts.ts', () => {
  it('leaves out a command without a name, and gives no keys as empty', async () => {
    const { api } = fakeCommands([
      { shortcut: 'Ctrl+X' },
      { name: 'bare' },
      { name: 'full', shortcut: 'Ctrl+F' },
    ]);

    await expect(createBrowserShortcuts(() => api).getAll()).resolves.toEqual([
      { name: 'bare', shortcut: '' },
      { name: 'full', shortcut: 'Ctrl+F' },
    ]);
  });

  it('hands the changes over to the browser as it expects them', async () => {
    const { api, update, reset } = fakeCommands([]);
    const shortcuts = createBrowserShortcuts(() => api);

    await shortcuts.update('first', 'Alt+1');
    await shortcuts.reset('first');

    expect(update).toHaveBeenCalledWith({ name: 'first', shortcut: 'Alt+1' });
    expect(reset).toHaveBeenCalledWith('first');
  });

  it('passes on failures', async () => {
    const { api, update } = fakeCommands([]);
    update.mockRejectedValueOnce(new Error('bad keys'));

    await expect(
      createBrowserShortcuts(() => api).update('first', '??'),
    ).rejects.toThrow('bad keys');
  });

  it('reads nothing from the browser until it is used', () => {
    const getApi = vi.fn(() => fakeCommands([]).api);

    createBrowserShortcuts(getApi);

    expect(getApi).not.toHaveBeenCalled();
  });
});

describe('adapters/memory/shortcuts.ts', () => {
  it('has no commands to begin with', async () => {
    await expect(createMemoryShortcuts().getAll()).resolves.toEqual([]);
  });

  it('remembers what was done', async () => {
    const shortcuts = createMemoryShortcuts([{ name: 'a', shortcut: 'X' }]);

    await shortcuts.update('a', 'Y');
    await shortcuts.reset('a');

    expect(shortcuts.calls).toEqual(['update a Y', 'reset a']);
  });

  it('changes nothing on a reset or an update of a command it does not have', async () => {
    const shortcuts = createMemoryShortcuts([{ name: 'a', shortcut: 'X' }]);

    await shortcuts.reset('b');
    await shortcuts.update('b', 'Z');

    await expect(shortcuts.getAll()).resolves.toEqual([
      { name: 'a', shortcut: 'X' },
    ]);
  });

  it('keeps a copy of the commands it starts with', async () => {
    const initial = [{ name: 'a', shortcut: 'X' }];
    const shortcuts = createMemoryShortcuts(initial);
    await shortcuts.update('a', 'Y');

    await shortcuts.reset('a');

    expect(initial).toEqual([{ name: 'a', shortcut: 'X' }]);
    expect((await shortcuts.getAll())[0]?.shortcut).toBe('X');
  });
});
