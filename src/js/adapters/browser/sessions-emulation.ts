import { isRecord } from '../../share/guards.js';
import { createExclusively, type Exclusively } from './exclusive.js';

/** The part of `browser.storage.local` the emulation uses */
export interface StorageArea {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

/** `browser.sessions` values, as a browser without them can keep them */
export interface SessionsEmulation {
  getTabValue: (tabId: number, key: string) => Promise<unknown>;
  setTabValue: (tabId: number, key: string, value: unknown) => Promise<void>;
  removeTabValue: (tabId: number, key: string) => Promise<void>;
  getWindowValue: (windowId: number, key: string) => Promise<unknown>;
  setWindowValue: (
    windowId: number,
    key: string,
    value: unknown,
  ) => Promise<void>;
  removeWindowValue: (windowId: number, key: string) => Promise<void>;
}

// Where earlier versions kept the values; changing it would lose users' groups
const STORAGE_KEY = '__mock_sessions';

type Values = Record<string, unknown>;
type Scope = Record<string, Values>;
type ScopeName = 'tabs' | 'windows';
type Data = Record<ScopeName, Scope>;

function recordsIn(value: unknown): Scope {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([id, values]) => {
      if (!isRecord(values)) {
        return [];
      }
      const entry: [string, Values] = [id, values];
      return [entry];
    }),
  );
}

/**
 * Chromium has no `browser.sessions` values, so they are kept in the
 * extension's storage instead. Calls take turns, because each one reads and
 * writes everything.
 */
export function createSessionsEmulation(
  getStorage: () => StorageArea,
  exclusively: Exclusively = createExclusively(undefined),
): SessionsEmulation {
  const load = async (): Promise<Data> => {
    const stored = (await getStorage().get(STORAGE_KEY))[STORAGE_KEY];
    const data = isRecord(stored) ? stored : {};
    return { tabs: recordsIn(data.tabs), windows: recordsIn(data.windows) };
  };

  const save = (data: Data): Promise<void> =>
    getStorage().set({ [STORAGE_KEY]: data });

  const read = (scope: ScopeName, id: number, key: string): Promise<unknown> =>
    exclusively(async () => (await load())[scope][String(id)]?.[key]);

  const write = (
    scope: ScopeName,
    id: number,
    key: string,
    value: unknown,
  ): Promise<void> =>
    exclusively(async () => {
      const data = await load();
      const values = data[scope][String(id)] ?? {};
      await save({
        ...data,
        [scope]: { ...data[scope], [String(id)]: { ...values, [key]: value } },
      });
    });

  const erase = (scope: ScopeName, id: number, key: string): Promise<void> =>
    exclusively(async () => {
      const data = await load();
      const values = data[scope][String(id)];
      if (values === undefined) {
        return;
      }
      await save({
        ...data,
        [scope]: {
          ...data[scope],
          [String(id)]: Object.fromEntries(
            Object.entries(values).filter(([name]) => name !== key),
          ),
        },
      });
    });

  return {
    getTabValue: (tabId, key) => read('tabs', tabId, key),
    setTabValue: (tabId, key, value) => write('tabs', tabId, key, value),
    removeTabValue: (tabId, key) => erase('tabs', tabId, key),
    getWindowValue: (windowId, key) => read('windows', windowId, key),
    setWindowValue: (windowId, key, value) =>
      write('windows', windowId, key, value),
    removeWindowValue: (windowId, key) => erase('windows', windowId, key),
  };
}
