import { describe, expect, it } from 'vitest';
import {
  DEFAULT_THEME,
  DEFAULT_TOOLBAR_POSITION,
  createDefaultOptions,
  parseOptions,
  type Options,
} from '../../../src/js/core/options.js';

const expectedShortcuts = {
  'activate-next-group': { disabled: false },
  'activate-previous-group': { disabled: false },
  'manage-extension': { disabled: false },
};

const defaults: Options = {
  toolbarPosition: 'top',
  useNativeGroups: true,
  shortcut: expectedShortcuts,
  theme: 'auto',
  view: 'popup',
};

describe('core/options.ts', () => {
  it('names the defaults of the look of the view', () => {
    expect(DEFAULT_THEME).toBe('auto');
    expect(DEFAULT_TOOLBAR_POSITION).toBe('top');
  });

  describe('createDefaultOptions', () => {
    it('returns the documented defaults', () => {
      expect(createDefaultOptions('1.0', true)).toEqual(defaults);
    });

    it.each([
      ['1.0', 'popup'],
      ['1', 'popup'],
      ['2.5.1', 'popup'],
      ['0.9.0', 'freeform'],
      ['0', 'freeform'],
      ['not a version', 'freeform'],
    ])('uses the %s manifest version to pick the %s view', (version, view) => {
      expect(createDefaultOptions(version, true).view).toBe(view);
    });

    it.each([true, false])(
      'enables native groups only when the API is available (%s)',
      (available) => {
        expect(createDefaultOptions('1.0', available).useNativeGroups).toBe(
          available,
        );
      },
    );
  });

  describe('parseOptions', () => {
    it.each([undefined, null, 'text', 5, true])(
      'returns the defaults when storage gave %s',
      (stored) => {
        expect(parseOptions(stored, defaults)).toEqual(defaults);
      },
    );

    it('takes every valid stored value', () => {
      const stored = {
        toolbarPosition: 'left',
        useNativeGroups: false,
        shortcut: { 'activate-next-group': { disabled: true } },
        theme: 'dark',
        view: 'freeform',
      };

      expect(parseOptions(stored, defaults)).toEqual(stored);
    });

    it.each([
      ['toolbarPosition', 3],
      ['useNativeGroups', 'yes'],
      ['theme', null],
      ['view', {}],
    ])('falls back to the default when %s has the wrong type', (key, value) => {
      expect(parseOptions({ [key]: value }, defaults)).toEqual(defaults);
    });

    it('keeps a valid field next to an invalid one', () => {
      expect(parseOptions({ theme: 'dark', view: 7 }, defaults)).toEqual({
        ...defaults,
        theme: 'dark',
      });
    });

    it('does not read unknown stored keys', () => {
      expect(parseOptions({ extra: 'value' }, defaults)).toEqual(defaults);
    });

    describe('shortcuts', () => {
      it.each([undefined, null, 'x', 1])(
        'falls back to the default shortcuts for %s',
        (shortcut) => {
          expect(parseOptions({ shortcut }, defaults).shortcut).toBe(
            defaults.shortcut,
          );
        },
      );

      it('drops entries that are not shortcut options', () => {
        const shortcut = {
          valid: { disabled: true },
          missingFlag: {},
          wrongFlag: { disabled: 'no' },
          notAnObject: 'x',
          nothing: null,
        };

        expect(parseOptions({ shortcut }, defaults).shortcut).toEqual({
          valid: { disabled: true },
        });
      });

      it('copies only the disabled flag', () => {
        const shortcut = { a: { disabled: false, other: 'ignored' } };

        expect(parseOptions({ shortcut }, defaults).shortcut).toEqual({
          a: { disabled: false },
        });
      });

      it('keeps an empty stored object instead of the defaults', () => {
        expect(parseOptions({ shortcut: {} }, defaults).shortcut).toEqual({});
      });

      it('stores a __proto__ key as plain data', () => {
        const stored: unknown = JSON.parse(
          '{"shortcut": {"__proto__": {"disabled": true}}}',
        );

        const { shortcut } = parseOptions(stored, defaults);

        expect(Object.keys(shortcut)).toEqual(['__proto__']);
        expect(Object.getPrototypeOf(shortcut)).toBe(Object.prototype);
      });
    });
  });
});
