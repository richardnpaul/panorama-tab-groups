import { requireElement } from '../share/dom.js';
import type { Options } from '../share/options.js';

type Command = browser.commands.Command;

interface ShortcutsApi {
  commands: {
    getAll(): Promise<Command[]>;
    update(detail: { name: string; shortcut: string }): Promise<void>;
    reset(name: string): Promise<void>;
  };
  storage: { sync: { set(items: Options): Promise<void> } };
}

const api = (): ShortcutsApi => browser;

export const shortcuts = api().commands.getAll();

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

export async function updateShortcut(event: Event): Promise<void> {
  event.preventDefault();
  const shortcut = shortcutNameOf(event);

  await api().commands.update({
    name: shortcut,
    shortcut: shortcutInput(shortcut).value,
  });
}

export async function resetShortcut(event: Event): Promise<void> {
  event.preventDefault();
  const shortcut = shortcutNameOf(event);

  await api().commands.reset(shortcut);
  const commands = await api().commands.getAll();
  const command = commands.find(({ name }) => name === shortcut);
  if (command !== undefined) {
    shortcutInput(shortcut).value = command.shortcut ?? '';
  }
}

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
  await api().storage.sync.set(options);

  return shortcut;
}

export async function disableShortcut(
  options: Options,
  event: Event,
): Promise<void> {
  disableShortcutForm(await saveShortcutState(options, event, true));
}

export async function enableShortcut(
  options: Options,
  event: Event,
): Promise<void> {
  enableShortcutForm(await saveShortcutState(options, event, false));
}
