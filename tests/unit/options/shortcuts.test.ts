// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../../../src/js/share/options.js';

const getAll = vi.fn();
const update = vi.fn();
const reset = vi.fn();
const set = vi.fn();

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

async function loadModule() {
  return import('../../../src/js/options/shortcuts.js');
}

const storedOptions = (): Options => ({
  toolbarPosition: 'top',
  useNativeGroups: true,
  shortcut: { other: { disabled: false } },
  theme: 'auto',
  view: 'popup',
});

describe('options/shortcuts.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    getAll.mockReset().mockResolvedValue([
      { name: 'first', shortcut: 'Ctrl+A' },
      { name: 'second', shortcut: 'Ctrl+B' },
    ]);
    update.mockReset().mockResolvedValue(undefined);
    reset.mockReset().mockResolvedValue(undefined);
    set.mockReset().mockResolvedValue(undefined);
    Object.assign(globalThis, {
      browser: {
        commands: { getAll, update, reset },
        storage: { sync: { set } },
      },
    });
    document.body.innerHTML = FORM('first', 'Alt+1') + FORM('second', 'Alt+2');
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'browser');
    document.body.innerHTML = '';
  });

  describe('shortcuts', () => {
    it('is the list of commands requested when the module loads', async () => {
      const { shortcuts } = await loadModule();

      expect(getAll).toHaveBeenCalledTimes(1);
      await expect(shortcuts).resolves.toEqual([
        { name: 'first', shortcut: 'Ctrl+A' },
        { name: 'second', shortcut: 'Ctrl+B' },
      ]);
    });
  });

  describe('updateShortcut', () => {
    it('applies the typed shortcut to the command of the clicked form', async () => {
      const { updateShortcut } = await loadModule();
      input('second').value = 'Ctrl+Shift+Y';

      const { event, result } = click(
        button('second', 'updateShortcut'),
        updateShortcut,
      );
      await result;

      expect(event.defaultPrevented).toBe(true);
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith({
        name: 'second',
        shortcut: 'Ctrl+Shift+Y',
      });
    });

    it('fails when the click did not come from an element', async () => {
      const { updateShortcut } = await loadModule();

      const { result } = click(document, updateShortcut);

      await expect(result).rejects.toThrow(
        'Cannot tell which shortcut was clicked',
      );
      expect(update).not.toHaveBeenCalled();
    });

    it('fails when the button is not inside a form with an id', async () => {
      const { updateShortcut } = await loadModule();
      document.body.innerHTML = '<div><button id="lone"></button></div>';
      const lone = document.getElementById('lone');

      const { result } = click(lone ?? document, updateShortcut);

      await expect(result).rejects.toThrow(
        'Cannot tell which shortcut was clicked',
      );
    });

    it('fails when the button has no parent', async () => {
      const { updateShortcut } = await loadModule();
      const orphan = document.createElement('button');

      const { result } = click(orphan, updateShortcut);

      await expect(result).rejects.toThrow(
        'Cannot tell which shortcut was clicked',
      );
    });
  });

  describe('resetShortcut', () => {
    it('resets the command and shows the shortcut the browser now has', async () => {
      const { resetShortcut } = await loadModule();

      const { event, result } = click(
        button('second', 'resetShortcut'),
        resetShortcut,
      );
      await result;

      expect(event.defaultPrevented).toBe(true);
      expect(reset).toHaveBeenCalledTimes(1);
      expect(reset).toHaveBeenCalledWith('second');
      expect(input('second').value).toBe('Ctrl+B');
      expect(input('first').value).toBe('Alt+1');
    });

    it('resets before it reads the commands again', async () => {
      const { resetShortcut } = await loadModule();
      getAll.mockClear();

      const { result } = click(button('first', 'resetShortcut'), resetShortcut);
      await result;

      expect(reset.mock.invocationCallOrder[0]).toBeLessThan(
        getAll.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('shows an empty field when the command has no shortcut', async () => {
      const { resetShortcut } = await loadModule();
      getAll.mockResolvedValue([{ name: 'first' }]);

      const { result } = click(button('first', 'resetShortcut'), resetShortcut);
      await result;

      expect(input('first').value).toBe('');
    });

    it('leaves the field alone when the command is not listed', async () => {
      const { resetShortcut } = await loadModule();
      getAll.mockResolvedValue([{ name: 'unrelated', shortcut: 'Ctrl+Z' }]);

      const { result } = click(button('first', 'resetShortcut'), resetShortcut);
      await result;

      expect(input('first').value).toBe('Alt+1');
    });
  });

  describe('disableShortcutForm / enableShortcutForm', () => {
    it('disabling locks the input and swaps the buttons', async () => {
      const { disableShortcutForm } = await loadModule();

      disableShortcutForm('first');

      expect(input('first').disabled).toBe(true);
      expect(isHidden('first', 'updateShortcut')).toBe(true);
      expect(isHidden('first', 'resetShortcut')).toBe(true);
      expect(isHidden('first', 'disableShortcut')).toBe(true);
      expect(isHidden('first', 'enableShortcut')).toBe(false);
    });

    it('enabling unlocks the input and swaps the buttons back', async () => {
      const { disableShortcutForm, enableShortcutForm } = await loadModule();
      disableShortcutForm('first');

      enableShortcutForm('first');

      expect(input('first').disabled).toBe(false);
      expect(isHidden('first', 'updateShortcut')).toBe(false);
      expect(isHidden('first', 'resetShortcut')).toBe(false);
      expect(isHidden('first', 'disableShortcut')).toBe(false);
      expect(isHidden('first', 'enableShortcut')).toBe(true);
    });

    it('only changes the form it was asked about', async () => {
      const { disableShortcutForm } = await loadModule();

      disableShortcutForm('first');

      expect(input('second').disabled).toBe(false);
      expect(isHidden('second', 'updateShortcut')).toBe(false);
      expect(isHidden('second', 'enableShortcut')).toBe(true);
    });

    it('fails when the form is missing', async () => {
      const { disableShortcutForm } = await loadModule();

      expect(() => {
        disableShortcutForm('missing');
      }).toThrow('Element not found: #missing input');
    });

    it.each([
      'updateShortcut',
      'resetShortcut',
      'disableShortcut',
      'enableShortcut',
    ])('fails when the %s button is missing', async (kind) => {
      const { enableShortcutForm } = await loadModule();
      button('first', kind).remove();

      expect(() => {
        enableShortcutForm('first');
      }).toThrow(`Element not found: #first .${kind}`);
    });
  });

  describe('disableShortcut', () => {
    it('stores the shortcut as disabled and locks its form', async () => {
      const { disableShortcut } = await loadModule();
      const options = storedOptions();

      const { event, result } = click(
        button('second', 'disableShortcut'),
        (e) => disableShortcut(options, e),
      );
      await result;

      expect(event.defaultPrevented).toBe(true);
      expect(options.shortcut).toEqual({
        other: { disabled: false },
        second: { disabled: true },
      });
      expect(set).toHaveBeenCalledTimes(1);
      expect(set.mock.calls[0]?.[0]).toBe(options);
      expect(input('second').disabled).toBe(true);
      expect(isHidden('second', 'enableShortcut')).toBe(false);
    });

    it('does not touch the form until the options are stored', async () => {
      const { disableShortcut } = await loadModule();
      let release: () => void = () => undefined;
      set.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );

      const { result } = click(button('first', 'disableShortcut'), (e) =>
        disableShortcut(storedOptions(), e),
      );
      await Promise.resolve();

      expect(input('first').disabled).toBe(false);
      release();
      await result;
      expect(input('first').disabled).toBe(true);
    });

    it('stores a shortcut called __proto__ as plain data', async () => {
      const { disableShortcut } = await loadModule();
      document.body.innerHTML = FORM('__proto__', 'x');
      const options = storedOptions();

      const { result } = click(button('__proto__', 'disableShortcut'), (e) =>
        disableShortcut(options, e),
      );
      await result;

      expect(Object.keys(options.shortcut)).toContain('__proto__');
      expect(Object.getPrototypeOf(options.shortcut)).toBe(Object.prototype);
    });
  });

  describe('enableShortcut', () => {
    it('stores the shortcut as enabled and unlocks its form', async () => {
      const { disableShortcutForm, enableShortcut } = await loadModule();
      disableShortcutForm('second');
      const options = storedOptions();
      options.shortcut.second = { disabled: true };

      const { event, result } = click(button('second', 'enableShortcut'), (e) =>
        enableShortcut(options, e),
      );
      await result;

      expect(event.defaultPrevented).toBe(true);
      expect(options.shortcut).toEqual({
        other: { disabled: false },
        second: { disabled: false },
      });
      expect(set.mock.calls[0]?.[0]).toBe(options);
      expect(input('second').disabled).toBe(false);
      expect(isHidden('second', 'enableShortcut')).toBe(true);
    });
  });
});
