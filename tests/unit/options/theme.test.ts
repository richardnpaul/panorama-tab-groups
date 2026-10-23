// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OptionsStore } from '../../../src/js/ports/options.js';
import { createThemeSaver } from '../../../src/js/options/theme.js';

const set = vi.fn<OptionsStore['save']>();
const saveOptionTheme = createThemeSaver({ options: { save: set } });

describe('options/theme.ts', () => {
  beforeEach(() => {
    set.mockReset().mockResolvedValue(undefined);
    document.body.innerHTML = `
      <input type="radio" name="theme" value="light" />
      <input type="radio" name="theme" value="dark" checked />
      <input type="radio" name="view" value="freeform" checked />
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('saves the checked theme', async () => {
    await saveOptionTheme();

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it('follows the radio button that is checked', async () => {
    document.body.innerHTML = `
      <input type="radio" name="theme" value="light" checked />
      <input type="radio" name="theme" value="dark" />
    `;

    await saveOptionTheme();

    expect(set).toHaveBeenCalledWith({ theme: 'light' });
  });

  it('waits for the browser to store the value', async () => {
    let stored = false;
    set.mockImplementation(async () => {
      await Promise.resolve();
      stored = true;
    });

    await saveOptionTheme();

    expect(stored).toBe(true);
  });

  it('fails without saving when no theme is checked', async () => {
    document.body.innerHTML =
      '<input type="radio" name="theme" value="dark" />';

    await expect(saveOptionTheme()).rejects.toThrow(
      'Element not found: input[name="theme"]:checked',
    );
    expect(set).not.toHaveBeenCalled();
  });
});
