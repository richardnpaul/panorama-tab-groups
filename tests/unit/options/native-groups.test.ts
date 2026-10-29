// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultOptions,
  type Options,
} from '../../../src/js/core/options.js';
import initNativeGroupsOption from '../../../src/js/options/native-groups.js';
import type { Messaging } from '../../../src/js/ports/messaging.js';
import { markedMessage } from '../../support/messages.js';
import type { OptionsStore } from '../../../src/js/ports/options.js';
import type { BrowserMode } from '../../../src/js/share/capabilities.js';

const loadOptions = vi.fn<OptionsStore['load']>();
const set = vi.fn<OptionsStore['save']>();
const sendMessage = vi.fn<Messaging['send']>();

const fn = () => undefined;

/** Start the option on a browser that can do what the mode needs */
const initIn = (mode: BrowserMode) =>
  initNativeGroupsOption({
    i18n: { getMessage: markedMessage },
    options: {
      load: loadOptions,
      save: set,
      isSet: () => Promise.resolve(true),
    },
    messaging: { send: sendMessage },
    capabilities: {
      hasTabHide: mode === 'hybrid' || mode === 'legacy',
      hasTabGroups: mode === 'hybrid' || mode === 'collapse-only',
    },
  });

const optionsWith = (useNativeGroups: boolean): Options => ({
  ...createDefaultOptions('1.0', true),
  useNativeGroups,
});

const PAGE = `
  <div id="nativeGroupsContainer">
    <input type="checkbox" id="useNativeGroups" />
    <span id="nativeGroupsWarning"></span>
  </div>
  <div id="nativeGroupsFeedback" style="display: none"></div>
`;

const checkbox = () => {
  const element = document.getElementById('useNativeGroups');
  if (!(element instanceof HTMLInputElement)) {
    throw new Error('test page has no checkbox');
  }
  return element;
};
const html = (id: string) => document.getElementById(id);

async function setUp(mode: BrowserMode, useNativeGroups = true) {
  loadOptions.mockResolvedValue(optionsWith(useNativeGroups));
  await initIn(mode);
}

function toggle(checked: boolean) {
  const box = checkbox();
  box.checked = checked;
  box.dispatchEvent(new Event('change'));
}

describe('options/native-groups.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    loadOptions.mockReset();
    set.mockReset().mockResolvedValue(undefined);
    sendMessage.mockReset().mockResolvedValue(undefined);
    document.body.innerHTML = PAGE;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe.each([
    {
      mode: 'hybrid' as const,
      disabled: false,
      className: 'info-text',
      opacity: '',
      message: markedMessage('optionsNativeGroupsHybrid'),
    },
    {
      mode: 'collapse-only' as const,
      disabled: false,
      className: 'warning-text',
      opacity: '0.5',
      message: markedMessage('optionsNativeGroupsCollapseOnly'),
    },
    {
      mode: 'legacy' as const,
      disabled: true,
      className: 'warning-text',
      opacity: '0.5',
      message: markedMessage('optionsNativeGroupsLegacy'),
    },
    {
      mode: 'unsupported' as const,
      disabled: true,
      className: 'warning-text',
      opacity: '0.5',
      message: markedMessage('optionsNativeGroupsUnsupported'),
    },
  ])('in $mode mode', ({ mode, disabled, className, opacity, message }) => {
    it('shows the explanation for the mode', async () => {
      await setUp(mode);

      expect(html('nativeGroupsWarning')?.textContent).toBe(message);
      expect(html('nativeGroupsWarning')?.className).toBe(className);
    });

    it('enables or disables the checkbox and dims the container', async () => {
      await setUp(mode);

      expect(checkbox().disabled).toBe(disabled);
      expect(html('nativeGroupsContainer')?.style.opacity).toBe(opacity);
    });
  });

  describe('the checkbox state', () => {
    it.each([true, false])(
      'follows the stored option %s in hybrid mode',
      async (stored) => {
        await setUp('hybrid', stored);

        expect(checkbox().checked).toBe(stored);
      },
    );

    it.each([true, false])(
      'is always checked in collapse-only mode (stored %s)',
      async (stored) => {
        await setUp('collapse-only', stored);

        expect(checkbox().checked).toBe(true);
      },
    );

    it.each(['legacy', 'unsupported'] as const)(
      'is always unchecked in %s mode, even if stored on',
      async (mode) => {
        await setUp(mode, true);

        expect(checkbox().checked).toBe(false);
      },
    );
  });

  describe('initialisation', () => {
    it('waits for the stored options before it touches the page', async () => {
      let release: (value: Options) => void = () => undefined;
      loadOptions.mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      const done = initIn('hybrid');
      await Promise.resolve();
      expect(html('nativeGroupsWarning')?.textContent).toBe('');

      release(optionsWith(true));
      await done;
      expect(html('nativeGroupsWarning')?.textContent).not.toBe('');
    });

    it('does nothing when the checkbox is missing', async () => {
      document.getElementById('useNativeGroups')?.remove();

      await setUp('hybrid');

      expect(html('nativeGroupsWarning')?.textContent).toBe('');
    });

    it('does nothing when the checkbox is not an input', async () => {
      document.getElementById('useNativeGroups')?.remove();
      document.body.insertAdjacentHTML(
        'beforeend',
        '<div id="useNativeGroups"></div>',
      );

      await setUp('hybrid');

      expect(html('nativeGroupsWarning')?.textContent).toBe('');
    });

    it('does nothing when the container is missing', async () => {
      document.body.innerHTML =
        '<input type="checkbox" id="useNativeGroups" /><span id="nativeGroupsWarning"></span>';

      await setUp('hybrid');

      expect(html('nativeGroupsWarning')?.textContent).toBe('');
      expect(checkbox().disabled).toBe(false);
    });

    it('fails naming the warning element when it is missing', async () => {
      html('nativeGroupsWarning')?.remove();

      await expect(setUp('hybrid')).rejects.toThrow(
        'Element not found: #nativeGroupsWarning',
      );
    });
  });

  describe('changing the option', () => {
    it('enabling saves it and asks the background to migrate', async () => {
      await setUp('hybrid', false);

      toggle(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith({ useNativeGroups: true });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'migrateToHybridGroups',
      });
    });

    it('disabling saves it and asks the background to clean up', async () => {
      await setUp('hybrid', true);

      toggle(false);
      await vi.advanceTimersByTimeAsync(0);

      expect(set).toHaveBeenCalledWith({ useNativeGroups: false });
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'cleanupNativeGroups',
      });
    });

    it('saves as soon as the box changes, then messages once it is stored', async () => {
      await setUp('hybrid', false);
      let stored: () => void = () => undefined;
      set.mockReturnValue(
        new Promise<void>((resolve) => {
          stored = resolve;
        }),
      );

      toggle(true);
      expect(set).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(0);
      expect(sendMessage).not.toHaveBeenCalled();

      stored();
      await vi.advanceTimersByTimeAsync(0);
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('logs and does not message when saving fails', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(fn);
      const failure = new Error('storage is full');
      set.mockRejectedValue(failure);
      await setUp('hybrid', false);

      toggle(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(sendMessage).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        '[Options] Failed to update native groups:',
        failure,
      );
    });

    it('logs when the background cannot be reached', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(fn);
      const failure = new Error('no receiver');
      sendMessage.mockRejectedValue(failure);
      await setUp('hybrid', false);

      toggle(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(error).toHaveBeenCalledWith(
        '[Options] Failed to update native groups:',
        failure,
      );
    });

    it('does not log anything when everything works', async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(fn);
      await setUp('hybrid', false);

      toggle(true);
      await vi.advanceTimersByTimeAsync(0);

      expect(error).not.toHaveBeenCalled();
    });
  });

  describe('feedback', () => {
    it('says that groups are being migrated when enabled', async () => {
      await setUp('hybrid', false);

      toggle(true);

      expect(html('nativeGroupsFeedback')?.textContent).toBe(
        markedMessage('optionsNativeGroupsEnabled'),
      );
      expect(html('nativeGroupsFeedback')?.style.display).toBe('block');
    });

    it('says that groups are being cleaned up when disabled', async () => {
      await setUp('hybrid', true);

      toggle(false);

      expect(html('nativeGroupsFeedback')?.textContent).toBe(
        markedMessage('optionsNativeGroupsDisabled'),
      );
    });

    it('hides again after exactly three seconds', async () => {
      await setUp('hybrid', false);

      toggle(true);
      await vi.advanceTimersByTimeAsync(2999);
      expect(html('nativeGroupsFeedback')?.style.display).toBe('block');

      await vi.advanceTimersByTimeAsync(1);
      expect(html('nativeGroupsFeedback')?.style.display).toBe('none');
    });

    it('is optional on the page', async () => {
      html('nativeGroupsFeedback')?.remove();
      await setUp('hybrid', false);

      expect(() => {
        toggle(true);
      }).not.toThrow();
      await vi.advanceTimersByTimeAsync(0);
      expect(set).toHaveBeenCalledTimes(1);
    });
  });
});
