import type { Options } from '../core/options.js';
import type { OptionsStore } from '../ports/options.js';
import type { Shortcuts } from '../ports/shortcuts.js';
import { requireElement } from '../share/dom.js';

// Each shortcut is a form whose id is the command name; its buttons sit inside it
function shortcutNameOf(event: Event): string {
  const { target } = event;
  const name =
    target instanceof Element
      ? target.parentElement?.getAttribute('id')
      : undefined;
  if (name === undefined || name === null) {
    throw new Error('Cannot tell which shortcut was clicked');
  }
  return name;
}

const shortcutInput = (shortcut: string): HTMLInputElement =>
  requireElement(HTMLInputElement, `#${shortcut} input`);

function setShortcutFormEnabled(shortcut: string, enabled: boolean): void {
  shortcutInput(shortcut).disabled = !enabled;
  ['updateShortcut', 'resetShortcut', 'disableShortcut'].forEach((button) => {
    requireElement(Element, `#${shortcut} .${button}`).toggleAttribute(
      'hidden',
      !enabled,
    );
  });
  requireElement(Element, `#${shortcut} .enableShortcut`).toggleAttribute(
    'hidden',
    enabled,
  );
}

export function disableShortcutForm(shortcut: string): void {
  setShortcutFormEnabled(shortcut, false);
}

export function enableShortcutForm(shortcut: string): void {
  setShortcutFormEnabled(shortcut, true);
}

// Handlers of events, so they are passed around on their own
export interface ShortcutHandlers {
  update: (event: Event) => Promise<void>;
  reset: (event: Event) => Promise<void>;
  /** Turn the shortcut off, keeping the choice in the loaded options */
  disable: (options: Options, event: Event) => Promise<void>;
  enable: (options: Options, event: Event) => Promise<void>;
}

/** What the buttons of each shortcut's form do */
export function createShortcutHandlers({
  shortcuts,
  options: store,
}: {
  shortcuts: Shortcuts;
  options: Pick<OptionsStore, 'save'>;
}): ShortcutHandlers {
  async function saveShortcutState(
    options: Options,
    event: Event,
    disabled: boolean,
  ): Promise<string> {
    event.preventDefault();
    const shortcut = shortcutNameOf(event);

    // A spread defines the key as plain data; assigning to a key called
    // `__proto__` would replace the prototype instead
    options.shortcut = { ...options.shortcut, [shortcut]: { disabled } };
    await store.save({ shortcut: options.shortcut });

    return shortcut;
  }

  return {
    async update(event) {
      event.preventDefault();
      const shortcut = shortcutNameOf(event);

      await shortcuts.update(shortcut, shortcutInput(shortcut).value);
    },

    async reset(event) {
      event.preventDefault();
      const shortcut = shortcutNameOf(event);

      await shortcuts.reset(shortcut);
      const command = (await shortcuts.getAll()).find(
        ({ name }) => name === shortcut,
      );
      if (command !== undefined) {
        shortcutInput(shortcut).value = command.shortcut;
      }
    },

    async disable(options, event) {
      disableShortcutForm(await saveShortcutState(options, event, true));
    },

    async enable(options, event) {
      enableShortcutForm(await saveShortcutState(options, event, false));
    },
  };
}
