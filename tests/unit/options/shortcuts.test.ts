// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMemoryOptions,
  type MemoryOptions,
} from '../../../src/js/adapters/memory/options.js';
import {
  createMemoryShortcuts,
  type MemoryShortcuts,
} from '../../../src/js/adapters/memory/shortcuts.js';
import type { Options } from '../../../src/js/core/options.js';
import {
  createShortcutHandlers,
  disableShortcutForm,
  enableShortcutForm,
  type ShortcutHandlers,
} from '../../../src/js/options/shortcuts.js';

const FORM = (name: string, value: string) => `
  <div id="${name}">
    <input value="${value}" />
    <button class="updateShortcut"></button>
    <button class="resetShortcut"></button>
    <button class="disableShortcut"></button>
    <button class="enableShortcut" hidden></button>
  </div>
`;

const button = (name: string, kind: string): HTMLElement => {
  const element = document.querySelector<HTMLElement>(`#${name} .${kind}`);
  if (element === null) {
    throw new Error(`test page has no ${kind} button in ${name}`);
  }
  return element;
};

const input = (name: string): HTMLInputElement => {
  const element = document.querySelector<HTMLInputElement>(`#${name} input`);
  if (element === null) {
    throw new Error(`test page has no input in ${name}`);
  }
  return element;
};

const isHidden = (name: string, kind: string) =>
  button(name, kind).hasAttribute('hidden');

/** Click a button and run the handler with the genuine click event */
function click<T>(target: EventTarget, handler: (event: Event) => T) {
  // Not bubbling and one-shot, so a listener on `document` cannot leak into other tests
  const event = new MouseEvent('click', { cancelable: true, bubbles: false });
  let result: T | undefined;
  target.addEventListener(
    'click',
    (e) => {
      result = handler(e);
    },
    { once: true },
  );
  target.dispatchEvent(event);
  return { event, result };
}

const storedOptions = (): Options => ({
  toolbarPosition: 'top',
  useNativeGroups: true,
  shortcut: { other: { disabled: false } },
  theme: 'auto',
  view: 'popup',
});

describe('options/shortcuts.ts', () => {
  let shortcuts: MemoryShortcuts;
  let store: MemoryOptions;
  let handlers: ShortcutHandlers;

  const start = (
    initial = [
      { name: 'first', shortcut: 'Ctrl+A' },
      { name: 'second', shortcut: 'Ctrl+B' },
    ],
  ) => {
    shortcuts = createMemoryShortcuts(initial);
    handlers = createShortcutHandlers({ shortcuts, options: store });
  };

  beforeEach(() => {
    store = createMemoryOptions();
    start();
    document.body.innerHTML = FORM('first', 'Alt+1') + FORM('second', 'Alt+2');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('updateShortcut', () => {
    it('applies the typed shortcut to the command of the clicked form', async () => {
      input('second').value = 'Ctrl+Shift+Y';

      const { event, result } = click(
        button('second', 'updateShortcut'),
        handlers.update,
      );
      await result;

      expect(event.defaultPrevented).toBe(true);
      expect(shortcuts.calls).toEqual(['update second Ctrl+Shift+Y']);
    });

    it('fails when the click did not come from an element', async () => {
      const { result } = click(document, handlers.update);

      await expect(result).rejects.toThrow(
        'Cannot tell which shortcut was clicked',
      );
      expect(shortcuts.calls).toEqual([]);
    });

    it('fails when the button is not inside a form with an id', async () => {
      document.body.innerHTML = '<div><button id="lone"></button></div>';
      const lone = document.getElementById('lone');

      const { result } = click(lone ?? document, handlers.update);

      await expect(result).rejects.toThrow(
        'Cannot tell which shortcut was clicked',
      );
    });

    it('fails when the button has no parent', async () => {
      const orphan = document.createElement('button');

      const { result } = click(orphan, handlers.update);

      await expect(result).rejects.toThrow(
        'Cannot tell which shortcut was clicked',
      );
    });
  });

  describe('resetShortcut', () => {
    it('resets the command and shows the shortcut the browser now has', async () => {
      await shortcuts.update('second', 'Alt+2');

      const { event, result } = click(
        button('second', 'resetShortcut'),
        handlers.reset,
      );
      await result;

      expect(event.defaultPrevented).toBe(true);
      expect(shortcuts.calls).toEqual(['update second Alt+2', 'reset second']);
      expect(input('second').value).toBe('Ctrl+B');
      expect(input('first').value).toBe('Alt+1');
    });

    it('resets before it reads the commands again', async () => {
      const reset = vi.spyOn(shortcuts, 'reset');
      const getAll = vi.spyOn(shortcuts, 'getAll');

      const { result } = click(
        button('first', 'resetShortcut'),
        handlers.reset,
      );
      await result;

      expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
        getAll.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('shows an empty field when the command has no shortcut', async () => {
      start([{ name: 'first', shortcut: '' }]);

      const { result } = click(
        button('first', 'resetShortcut'),
        handlers.reset,
      );
      await result;

      expect(input('first').value).toBe('');
    });

    it('leaves the field alone when the command is not listed', async () => {
      start([{ name: 'unrelated', shortcut: 'Ctrl+Z' }]);

      const { result } = click(
        button('first', 'resetShortcut'),
        handlers.reset,
      );
      await result;

      expect(input('first').value).toBe('Alt+1');
    });
  });

  describe('disableShortcutForm / enableShortcutForm', () => {
    it('disabling locks the input and swaps the buttons', () => {
      disableShortcutForm('first');

      expect(input('first').disabled).toBe(true);
      expect(isHidden('first', 'updateShortcut')).toBe(true);
      expect(isHidden('first', 'resetShortcut')).toBe(true);
      expect(isHidden('first', 'disableShortcut')).toBe(true);
      expect(isHidden('first', 'enableShortcut')).toBe(false);
    });

    it('enabling unlocks the input and swaps the buttons back', () => {
      disableShortcutForm('first');

      enableShortcutForm('first');

      expect(input('first').disabled).toBe(false);
      expect(isHidden('first', 'updateShortcut')).toBe(false);
      expect(isHidden('first', 'resetShortcut')).toBe(false);
      expect(isHidden('first', 'disableShortcut')).toBe(false);
      expect(isHidden('first', 'enableShortcut')).toBe(true);
    });

    it('only changes the form it was asked about', () => {
      disableShortcutForm('first');

      expect(input('second').disabled).toBe(false);
      expect(isHidden('second', 'updateShortcut')).toBe(false);
      expect(isHidden('second', 'enableShortcut')).toBe(true);
    });

    it('fails when the form is missing', () => {
      expect(() => {
        disableShortcutForm('missing');
      }).toThrow('Element not found: #missing input');
    });

    it.each([
      'updateShortcut',
      'resetShortcut',
      'disableShortcut',
      'enableShortcut',
    ])('fails when the %s button is missing', (kind) => {
      button('first', kind).remove();

      expect(() => {
        enableShortcutForm('first');
      }).toThrow(`Element not found: #first .${kind}`);
    });
  });

  describe('disableShortcut', () => {
    it('stores the shortcut as disabled and locks its form', async () => {
      const options = storedOptions();

      const { event, result } = click(
        button('second', 'disableShortcut'),
        (e) => handlers.disable(options, e),
      );
      await result;

      expect(event.defaultPrevented).toBe(true);
      expect(options.shortcut).toEqual({
        other: { disabled: false },
        second: { disabled: true },
      });
      expect((await store.load()).shortcut).toEqual(options.shortcut);
      expect(input('second').disabled).toBe(true);
      expect(isHidden('second', 'enableShortcut')).toBe(false);
    });

    it('stores only the shortcuts, not the options the user did not change', async () => {
      const { result } = click(button('first', 'disableShortcut'), (e) =>
        handlers.disable(storedOptions(), e),
      );
      await result;

      expect(store.stored).toEqual({
        shortcut: { other: { disabled: false }, first: { disabled: true } },
      });
    });

    it('does not touch the form until the options are stored', async () => {
      let release: () => void = () => undefined;
      vi.spyOn(store, 'save').mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      const { result } = click(button('first', 'disableShortcut'), (e) =>
        handlers.disable(storedOptions(), e),
      );
      await Promise.resolve();

      expect(input('first').disabled).toBe(false);
      release();
      await result;
      expect(input('first').disabled).toBe(true);
    });

    it('stores a shortcut called __proto__ as plain data', async () => {
      document.body.innerHTML = FORM('__proto__', 'x');
      const options = storedOptions();

      const { result } = click(button('__proto__', 'disableShortcut'), (e) =>
        handlers.disable(options, e),
      );
      await result;

      expect(Object.keys(options.shortcut)).toContain('__proto__');
      expect(Object.getPrototypeOf(options.shortcut)).toBe(Object.prototype);
    });
  });

  describe('enableShortcut', () => {
    it('stores the shortcut as enabled and unlocks its form', async () => {
      disableShortcutForm('second');
      const options = storedOptions();
      options.shortcut.second = { disabled: true };

      const { event, result } = click(button('second', 'enableShortcut'), (e) =>
        handlers.enable(options, e),
      );
      await result;

      expect(event.defaultPrevented).toBe(true);
      expect(options.shortcut).toEqual({
        other: { disabled: false },
        second: { disabled: false },
      });
      expect((await store.load()).shortcut).toEqual(options.shortcut);
      expect(input('second').disabled).toBe(false);
      expect(isHidden('second', 'enableShortcut')).toBe(true);
    });
  });
});
