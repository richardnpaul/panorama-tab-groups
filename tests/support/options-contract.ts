import { beforeEach, describe, expect, it } from 'vitest';
import type { Options } from '../../src/js/core/options.js';
import type { OptionsStore } from '../../src/js/ports/options.js';

/**
 * What every OptionsStore must do, so the memory fake matches the browser.
 * `create` starts a store over what storage already holds; `defaults` are the
 * options it gives when storage holds nothing.
 */
export function describeOptionsStoreContract(
  name: string,
  create: (stored: Record<string, unknown>) => OptionsStore,
  defaults: Options,
): void {
  describe(`OptionsStore contract: ${name}`, () => {
    let store: OptionsStore;

    beforeEach(() => {
      store = create({});
    });

    it('gives the defaults when nothing is stored', async () => {
      await expect(store.load()).resolves.toEqual(defaults);
    });

    it('gives what is stored, and the defaults for the rest', async () => {
      store = create({
        theme: 'dark',
        useNativeGroups: !defaults.useNativeGroups,
      });

      await expect(store.load()).resolves.toEqual({
        ...defaults,
        theme: 'dark',
        useNativeGroups: !defaults.useNativeGroups,
      });
    });

    it('falls back to the default for a stored value of the wrong type', async () => {
      store = create({ theme: 3, view: 'freeform', shortcut: 'none' });

      await expect(store.load()).resolves.toEqual({
        ...defaults,
        view: 'freeform',
      });
    });

    it('says an option was never stored, though load gives its default', async () => {
      await expect(store.isSet('theme')).resolves.toBe(false);
      await expect(store.isSet('useNativeGroups')).resolves.toBe(false);
    });

    it('says an option was stored once it has been saved, and the others not', async () => {
      await store.save({ theme: 'dark' });

      await expect(store.isSet('theme')).resolves.toBe(true);
      await expect(store.isSet('view')).resolves.toBe(false);
    });

    it('says an option was stored when storage held it already, even as the default', async () => {
      store = create({ useNativeGroups: defaults.useNativeGroups });

      await expect(store.isSet('useNativeGroups')).resolves.toBe(true);
    });

    it('keeps what is saved and leaves the other options as they were', async () => {
      store = create({ view: 'freeform' });

      await store.save({ theme: 'light' });

      await expect(store.load()).resolves.toEqual({
        ...defaults,
        view: 'freeform',
        theme: 'light',
      });
    });

    it('saves the shortcuts without touching the rest', async () => {
      store = create({ toolbarPosition: 'left' });
      const shortcut = { 'activate-next-group': { disabled: true } };

      await store.save({ shortcut });

      await expect(store.load()).resolves.toEqual({
        ...defaults,
        toolbarPosition: 'left',
        shortcut,
      });
    });

    it('keeps the last of two saves of the same option', async () => {
      await store.save({ theme: 'light' });
      await store.save({ theme: 'dark' });

      expect((await store.load()).theme).toBe('dark');
    });

    it('keeps a copy of what is saved, not the object itself', async () => {
      const shortcut = { a: { disabled: true } };
      await store.save({ shortcut });

      shortcut.a.disabled = false;

      expect((await store.load()).shortcut).toEqual({ a: { disabled: true } });
    });

    it('gives a copy each time, so changing one does not change the store', async () => {
      await store.save({ shortcut: { a: { disabled: true } } });
      const first = await store.load();

      first.theme = 'changed';
      first.shortcut = {};

      const second = await store.load();
      expect(second.theme).toBe(defaults.theme);
      expect(second.shortcut).toEqual({ a: { disabled: true } });
    });
  });
}
