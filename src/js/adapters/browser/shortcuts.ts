import type { Shortcuts } from '../../ports/shortcuts.js';

/** The part of `browser.commands` the options page uses */
export interface CommandsApi {
  commands: {
    getAll(): Promise<
      { name?: string | undefined; shortcut?: string | undefined }[]
    >;
    update(detail: { name: string; shortcut: string }): Promise<void>;
    reset(name: string): Promise<void>;
  };
}

export function createBrowserShortcuts(getApi: () => CommandsApi): Shortcuts {
  const commands = () => getApi().commands;

  return {
    // A command without a name cannot be changed, so it is left out
    getAll: async () =>
      (await commands().getAll()).flatMap(({ name, shortcut }) =>
        name === undefined ? [] : [{ name, shortcut: shortcut ?? '' }],
      ),
    update: (name, shortcut) => commands().update({ name, shortcut }),
    reset: (name) => commands().reset(name),
  };
}
