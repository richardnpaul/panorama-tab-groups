import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Options } from '../../../src/js/share/options.js';

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

interface FakeApi {
  version?: string;
  tabGroups?: unknown;
  tabs?: unknown;
  stored?: unknown;
}

const get = vi.fn();

function installBrowser(api: FakeApi = {}) {
  // Spread so that an explicit `undefined` removes a capability instead of defaulting it
  const { version, tabGroups, tabs, stored } = {
    version: '1.0',
    tabGroups: { query: vi.fn() },
    tabs: { group: vi.fn() },
    stored: {},
    ...api,
  };
  get.mockResolvedValue(stored);
  Object.assign(globalThis, {
    browser: {
      runtime: { getManifest: () => ({ version }) },
      storage: { sync: { get } },
      tabGroups,
      tabs,
    },
  });
}

// The module reads the browser when it is imported, so import it after installing one
async function loadModule(api: FakeApi = {}) {
  installBrowser(api);
  return import('../../../src/js/share/options.js');
}

describe('share/options.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    get.mockReset();
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'browser');
  });

  describe('createDefaultOptions', () => {
    it('returns the documented defaults', async () => {
      const { createDefaultOptions } = await loadModule();

      expect(createDefaultOptions('1.0', true)).toEqual(defaults);
    });

    it.each([
      ['1.0', 'popup'],
      ['1', 'popup'],
      ['2.5.1', 'popup'],
      ['0.9.0', 'freeform'],
      ['0', 'freeform'],
      ['not a version', 'freeform'],
    ])(
      'uses the %s manifest version to pick the %s view',
      async (version, view) => {
        const { createDefaultOptions } = await loadModule();

        expect(createDefaultOptions(version, true).view).toBe(view);
      },
    );

    it.each([true, false])(
      'enables native groups only when the API is available (%s)',
      async (available) => {
        const { createDefaultOptions } = await loadModule();

        expect(createDefaultOptions('1.0', available).useNativeGroups).toBe(
          available,
        );
      },
    );
  });

  describe('defaultOptions (computed from the browser at import)', () => {
    const load = async (api: FakeApi = {}) =>
      (await loadModule(api)).defaultOptions;

    it('uses the popup view for major version 1 and later', async () => {
      expect(await load({ version: '1.0' })).toEqual(defaults);
    });

    it('uses the freeform view before major version 1', async () => {
      expect((await load({ version: '0.9.0' })).view).toBe('freeform');
    });

    it('enables native groups when both APIs exist', async () => {
      expect((await load()).useNativeGroups).toBe(true);
    });

    it.each([
      ['tabGroups is missing', { tabGroups: undefined }],
      ['tabGroups.query is not a function', { tabGroups: { query: 'x' } }],
      ['tabGroups has no query', { tabGroups: {} }],
      ['tabs is missing', { tabs: undefined }],
      ['tabs.group is not a function', { tabs: { group: 1 } }],
      ['tabs has no group', { tabs: {} }],
    ])('disables native groups when %s', async (_name, overrides) => {
      expect((await load(overrides)).useNativeGroups).toBe(false);
    });
  });

  describe('parseOptions', () => {
    it.each([undefined, null, 'text', 5, true])(
      'returns the defaults when storage gave %s',
      async (stored) => {
        const { parseOptions } = await loadModule();

        expect(parseOptions(stored, defaults)).toEqual(defaults);
      },
    );

    it('takes every valid stored value', async () => {
      const { parseOptions } = await loadModule();
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
    ])(
      'falls back to the default when %s has the wrong type',
      async (key, value) => {
        const { parseOptions } = await loadModule();

        expect(parseOptions({ [key]: value }, defaults)).toEqual(defaults);
      },
    );

    it('keeps a valid field next to an invalid one', async () => {
      const { parseOptions } = await loadModule();
      expect(parseOptions({ theme: 'dark', view: 7 }, defaults)).toEqual({
        ...defaults,
        theme: 'dark',
      });
    });

    it('does not read unknown stored keys', async () => {
      const { parseOptions } = await loadModule();
      expect(parseOptions({ extra: 'value' }, defaults)).toEqual(defaults);
    });

    describe('shortcuts', () => {
      it.each([undefined, null, 'x', 1])(
        'falls back to the default shortcuts for %s',
        async (shortcut) => {
          const { parseOptions } = await loadModule();

          expect(parseOptions({ shortcut }, defaults).shortcut).toBe(
            defaults.shortcut,
          );
        },
      );

      it('drops entries that are not shortcut options', async () => {
        const { parseOptions } = await loadModule();
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

      it('copies only the disabled flag', async () => {
        const { parseOptions } = await loadModule();
        const shortcut = { a: { disabled: false, other: 'ignored' } };

        expect(parseOptions({ shortcut }, defaults).shortcut).toEqual({
          a: { disabled: false },
        });
      });

      it('keeps an empty stored object instead of the defaults', async () => {
        const { parseOptions } = await loadModule();
        expect(parseOptions({ shortcut: {} }, defaults).shortcut).toEqual({});
      });

      it('stores a __proto__ key as plain data', async () => {
        const { parseOptions } = await loadModule();
        const stored: unknown = JSON.parse(
          '{"shortcut": {"__proto__": {"disabled": true}}}',
        );

        const { shortcut } = parseOptions(stored, defaults);

        expect(Object.keys(shortcut)).toEqual(['__proto__']);
        expect(Object.getPrototypeOf(shortcut)).toBe(Object.prototype);
      });
    });
  });

  describe('loadOptions', () => {
    it('asks storage for the defaults and parses the answer', async () => {
      installBrowser({ stored: { view: 'freeform', theme: 'dark' } });
      const { loadOptions, defaultOptions } =
        await import('../../../src/js/share/options.js');

      const options = await loadOptions();

      expect(get).toHaveBeenLastCalledWith(defaultOptions);
      expect(options).toEqual({
        ...defaults,
        view: 'freeform',
        theme: 'dark',
      });
    });

    it('falls back to the defaults when storage gives nothing', async () => {
      const { loadOptions } = await loadModule({ stored: undefined });

      await expect(loadOptions()).resolves.toEqual(defaults);
    });
  });

  describe('currentOptions', () => {
    it('loads the options once when the module is imported', async () => {
      installBrowser({ stored: { theme: 'light' } });

      const { currentOptions } =
        await import('../../../src/js/share/options.js');

      expect(get).toHaveBeenCalledTimes(1);
      await expect(currentOptions).resolves.toEqual({
        ...defaults,
        theme: 'light',
      });
    });
  });
});
