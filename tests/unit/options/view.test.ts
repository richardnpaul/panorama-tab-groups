// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  saveOptionView,
  showViewSpecificOptions,
} from '../../../src/js/options/view.js';

const set = vi.fn();
const sendMessage = vi.fn();

function renderPage(checkedView: string | null) {
  const checked = (value: string) => (value === checkedView ? 'checked' : '');
  document.body.innerHTML = `
    <div id="optionsToolbar"></div>
    <input type="radio" name="view" value="popup" ${checked('popup')} />
    <input type="radio" name="view" value="freeform" ${checked('freeform')} />
  `;
}

const toolbar = () => document.querySelector('#optionsToolbar');

describe('options/view.ts', () => {
  beforeEach(() => {
    set.mockReset().mockResolvedValue(undefined);
    sendMessage.mockReset().mockResolvedValue(undefined);
    Object.assign(globalThis, {
      browser: { storage: { sync: { set } }, runtime: { sendMessage } },
    });
    renderPage('popup');
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'browser');
    document.body.innerHTML = '';
  });

  describe('showViewSpecificOptions', () => {
    it('shows the toolbar options for the freeform view', () => {
      toolbar()?.setAttribute('hidden', '');

      showViewSpecificOptions('freeform');

      expect(toolbar()?.hasAttribute('hidden')).toBe(false);
    });

    it.each(['popup', 'native', '', 'Freeform'])(
      'hides the toolbar options for the %j view',
      (view) => {
        showViewSpecificOptions(view);

        expect(toolbar()?.hasAttribute('hidden')).toBe(true);
      },
    );

    it('hides them again after switching away from freeform', () => {
      showViewSpecificOptions('freeform');
      showViewSpecificOptions('popup');

      expect(toolbar()?.hasAttribute('hidden')).toBe(true);
    });

    it('fails when the page has no toolbar options', () => {
      document.body.innerHTML = '';

      expect(() => {
        showViewSpecificOptions('freeform');
      }).toThrow('Element not found: #optionsToolbar');
    });
  });

  describe('saveOptionView', () => {
    it('saves the checked view and asks the background to refresh it', async () => {
      renderPage('freeform');

      await saveOptionView();

      expect(set).toHaveBeenCalledTimes(1);
      expect(set).toHaveBeenCalledWith({ view: 'freeform' });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith({ action: 'refreshView' });
    });

    it('saves before it asks for the refresh', async () => {
      await saveOptionView();

      expect(set.mock.invocationCallOrder[0]).toBeLessThan(
        sendMessage.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('waits for the refresh message to be answered', async () => {
      let answered = false;
      sendMessage.mockImplementation(async () => {
        await Promise.resolve();
        answered = true;
      });
      renderPage('freeform');
      toolbar()?.setAttribute('hidden', '');

      await saveOptionView();

      expect(answered).toBe(true);
      expect(toolbar()?.hasAttribute('hidden')).toBe(false);
    });

    it('shows the toolbar options when freeform was chosen', async () => {
      renderPage('freeform');
      toolbar()?.setAttribute('hidden', '');

      await saveOptionView();

      expect(toolbar()?.hasAttribute('hidden')).toBe(false);
    });

    it('hides the toolbar options when another view was chosen', async () => {
      renderPage('popup');

      await saveOptionView();

      expect(toolbar()?.hasAttribute('hidden')).toBe(true);
    });

    it('does nothing when no view is checked', async () => {
      renderPage(null);

      await expect(saveOptionView()).rejects.toThrow(
        'Element not found: input[name="view"]:checked',
      );
      expect(set).not.toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});
