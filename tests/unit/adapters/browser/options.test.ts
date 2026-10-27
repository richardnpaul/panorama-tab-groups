import { describe, expect, it, vi } from 'vitest';
import {
  createBrowserOptions,
  type OptionsApi,
} from '../../../../src/js/adapters/browser/options.js';
import {
  createDefaultOptions,
  type Options,
} from '../../../../src/js/core/options.js';
import { describeOptionsStoreContract } from '../../../support/options-contract.js';

interface FakeBrowser {
  version?: string;
  // An explicit `undefined` takes the API away
  tabGroups?: { query?: unknown } | undefined;
  tabs?: { group?: unknown } | undefined;
}

/**
 * `browser.storage.sync` as the browser has it: `get` with an object answers
 * with the stored value of each key, or the given default; values are copies
 */
function fakeBrowser(
  stored: Record<string, unknown> = {},
  overrides: FakeBrowser = {},
) {
  const data: Record<string, unknown> = structuredClone(stored);
  const { version, tabGroups, tabs } = {
    version: '1.0',
    tabGroups: { query: () => undefined },
    tabs: { group: () => undefined },
    ...overrides,
  };
  const get = vi.fn((keys: Options) =>
    Promise.resolve(
      structuredClone(
        Object.fromEntries(
          Object.entries(keys).map(([key, fallback]) => [
            key,
            key in data ? data[key] : fallback,
          ]),
        ),
      ),
    ),
  );
  const set = vi.fn((items: Partial<Options>) => {
    Object.assign(data, structuredClone(items));
    return Promise.resolve();
  });
  const api: OptionsApi = {
    runtime: { getManifest: () => ({ version }) },
    storage: { sync: { get, set } },
    ...(tabGroups === undefined ? {} : { tabGroups }),
    ...(tabs === undefined ? {} : { tabs }),
  };
  return { api, get, set, data };
}

describeOptionsStoreContract(
  'browser',
  (stored) => {
    const { api } = fakeBrowser(stored);
    return createBrowserOptions(() => api);
  },
  createDefaultOptions('1.0', true),
);

describe('adapters/browser/options.ts', () => {
  it('reads nothing from the browser until the options are loaded', () => {
    const getApi = vi.fn(() => fakeBrowser().api);

    createBrowserOptions(getApi);

    expect(getApi).not.toHaveBeenCalled();
  });

  it('asks storage for every option with its default', async () => {
    const { api, get } = fakeBrowser();

    await createBrowserOptions(() => api).load();

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(createDefaultOptions('1.0', true));
  });

  it('falls back to the defaults when storage answers with nothing', async () => {
    const { api, get } = fakeBrowser();
    get.mockResolvedValueOnce({});

    await expect(createBrowserOptions(() => api).load()).resolves.toEqual(
      createDefaultOptions('1.0', true),
    );
  });

  it('stores only the options it is given', async () => {
    const { api, set } = fakeBrowser();

    await createBrowserOptions(() => api).save({ theme: 'dark' });

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ theme: 'dark' });
  });

  it.each([
    ['1.0', 'popup'],
    ['0.8.12', 'freeform'],
  ])(
    'defaults to the view that fits manifest version %s (%s)',
    async (version, view) => {
      const { api } = fakeBrowser({}, { version });

      expect((await createBrowserOptions(() => api).load()).view).toBe(view);
    },
  );

  it('uses native groups by default when both APIs exist', async () => {
    const { api } = fakeBrowser();

    expect((await createBrowserOptions(() => api).load()).useNativeGroups).toBe(
      true,
    );
  });

  it.each([
    ['tabGroups is missing', { tabGroups: undefined }],
    ['tabGroups.query is not a function', { tabGroups: { query: 'x' } }],
    ['tabGroups has no query', { tabGroups: {} }],
    ['tabs is missing', { tabs: undefined }],
    ['tabs.group is not a function', { tabs: { group: 1 } }],
    ['tabs has no group', { tabs: {} }],
  ])(
    'does not use native groups by default when %s',
    async (_name, overrides) => {
      const { api } = fakeBrowser({}, overrides);

      expect(
        (await createBrowserOptions(() => api).load()).useNativeGroups,
      ).toBe(false);
    },
  );

  it('reads the browser afresh on every load', async () => {
    const first = fakeBrowser({ theme: 'dark' });
    const second = fakeBrowser({ theme: 'light' }, { version: '0.1' });
    const getApi = vi.fn(() => first.api);
    const options = createBrowserOptions(getApi);
    await options.load();

    getApi.mockReturnValue(second.api);

    await expect(options.load()).resolves.toMatchObject({
      theme: 'light',
      view: 'freeform',
    });
  });

  it('rejects when storage fails', async () => {
    const { api, get, set } = fakeBrowser();
    get.mockRejectedValueOnce(new Error('sync is off'));
    set.mockRejectedValueOnce(new Error('quota'));
    const options = createBrowserOptions(() => api);

    await expect(options.load()).rejects.toThrow('sync is off');
    await expect(options.save({ theme: 'dark' })).rejects.toThrow('quota');
  });
});
