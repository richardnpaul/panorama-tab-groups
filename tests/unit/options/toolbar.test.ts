// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OptionsStore } from '../../../src/js/ports/options.js';
import { createToolbarSaver } from '../../../src/js/options/toolbar.js';

const set = vi.fn<OptionsStore['save']>();
const saveOptionToolbarPosition = createToolbarSaver({
  options: { save: set },
});

describe('options/toolbar.ts', () => {
  beforeEach(() => {
    set.mockReset().mockResolvedValue(undefined);
    document.body.innerHTML = `
      <input type="radio" name="toolbarPosition" value="top" />
      <input type="radio" name="toolbarPosition" value="bottom" checked />
      <input type="radio" name="other" value="left" checked />
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('saves the checked toolbar position', async () => {
    await saveOptionToolbarPosition();

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ toolbarPosition: 'bottom' });
  });

  it('follows the radio button that is checked', async () => {
    document.body.innerHTML = `
      <input type="radio" name="toolbarPosition" value="top" checked />
      <input type="radio" name="toolbarPosition" value="bottom" />
    `;

    await saveOptionToolbarPosition();

    expect(set).toHaveBeenCalledWith({ toolbarPosition: 'top' });
  });

  it('waits for the browser to store the value', async () => {
    let stored = false;
    set.mockImplementation(async () => {
      await Promise.resolve();
      stored = true;
    });

    await saveOptionToolbarPosition();

    expect(stored).toBe(true);
  });

  it('fails without saving when no position is checked', async () => {
    document.body.innerHTML =
      '<input type="radio" name="toolbarPosition" value="top" />';

    await expect(saveOptionToolbarPosition()).rejects.toThrow(
      'Element not found: input[name="toolbarPosition"]:checked',
    );
    expect(set).not.toHaveBeenCalled();
  });
});
