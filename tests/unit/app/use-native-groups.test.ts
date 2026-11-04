import { describe, expect, it, vi } from 'vitest';
import { createUseNativeGroups } from '../../../src/js/app/use-native-groups.js';
import type { Options } from '../../../src/js/core/options.js';

const optionsWith = (useNativeGroups: boolean): Options => ({
  toolbarPosition: 'top',
  useNativeGroups,
  shortcut: {},
  theme: 'auto',
  view: 'popup',
});

describe('app/use-native-groups.ts', () => {
  it.each([
    [true, true, true, true],
    [true, true, false, false],
    [true, false, true, true],
    // Chromium: native groups are the only kind, whatever is stored
    [true, false, false, true],
    [false, true, true, false],
    [false, true, false, false],
    [false, false, true, false],
    [false, false, false, false],
  ])(
    'with native groups in the browser: %s, tabs it can hide: %s, and chosen by the user: %s, is %s',
    async (hasTabGroups, hasTabHide, chosen, expected) => {
      const load = vi.fn().mockResolvedValue(optionsWith(chosen));
      const use = createUseNativeGroups({
        hasTabGroups,
        hasTabHide,
        options: { load },
      });

      await expect(use()).resolves.toBe(expected);
    },
  );

  it.each([
    ['has no native groups', false, true],
    ['cannot hide tabs, so has only native groups', true, false],
  ])(
    'does not read the settings when the browser %s',
    async (_, hasTabGroups, hasTabHide) => {
      const load = vi.fn().mockResolvedValue(optionsWith(true));
      const use = createUseNativeGroups({
        hasTabGroups,
        hasTabHide,
        options: { load },
      });

      await use();

      expect(load).not.toHaveBeenCalled();
    },
  );

  it('reads the settings each time, as the user may change them', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(optionsWith(true))
      .mockResolvedValueOnce(optionsWith(false));
    const use = createUseNativeGroups({
      hasTabGroups: true,
      hasTabHide: true,
      options: { load },
    });

    await expect(use()).resolves.toBe(true);
    await expect(use()).resolves.toBe(false);
  });
});
