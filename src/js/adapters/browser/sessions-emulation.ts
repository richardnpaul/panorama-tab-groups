import { isRecord } from '../../share/guards.js';
import { createExclusively, type Exclusively } from './exclusive.js';

/** The part of `browser.storage.local` the emulation uses */
export interface StorageArea {
  get: (keys: string[]) => Promise<Record<string, unknown>>;
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
  /**
   * The ids that values are kept under, which nothing removes when a tab or window is closed.
   * A private window's or tab's are not among them: they are not kept.
   */
  windowIds: () => Promise<number[]>;
  tabIds: () => Promise<number[]>;
  /** The ids of private windows and tabs that values are kept apart for */
  privateWindowIds: () => Promise<number[]>;
  privateTabIds: () => Promise<number[]>;
  /**
   * Move the values of windows and tabs that are private to where those of private ones are kept.
   * For values stored before they were kept apart (see `GroupState.setPrivate`).
   */
  setPrivate: (
    windowIds: readonly number[],
    tabIds: readonly number[],
  ) => Promise<void>;
  /** Forget every value of a window, or of a tab, private or not */
  removeWindow: (windowId: number) => Promise<void>;
  removeTab: (tabId: number) => Promise<void>;
}

export type ScopeName = 'tabs' | 'windows';

/**
 * Whether a window or tab is private (incognito), asked the first time a value is stored for it;
 * rejects once it has closed
 */
export type IsPrivate = (scope: ScopeName, id: number) => Promise<boolean>;

// Where earlier versions kept the values; changing it would lose users' groups
const STORAGE_KEY = '__mock_sessions';
// Where the values of private windows and tabs are kept apart from the others
const PRIVATE_KEY = 'privateSessions';

type Values = Record<string, unknown>;
type Scope = Record<string, Values>;
type Data = Record<ScopeName, Scope>;

/**
 * The values that are kept, and those of private windows and tabs, kept apart. An id has values
 * in one part at most; both are read, and written, at once, so that no call sees one without the
 * other, and no call that stops halfway leaves an id in both.
 */
type Part = 'apart' | 'kept';
type State = Record<Part, Data>;

// In the order they are looked in
const PARTS: readonly Part[] = ['apart', 'kept'];
const KEY_OF: Record<Part, string> = {
  apart: PRIVATE_KEY,
  kept: STORAGE_KEY,
};

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

function dataIn(stored: unknown): Data {
  const data = isRecord(stored) ? stored : {};
  return { tabs: recordsIn(data.tabs), windows: recordsIn(data.windows) };
}

/** The data with the values of an id in place of those it had, or none left (`undefined`) */
function withValues(
  data: Data,
  scope: ScopeName,
  id: string,
  values: Values | undefined,
): Data {
  const { [id]: replaced, ...others } = data[scope];
  return {
    ...data,
    [scope]: values === undefined ? others : { ...others, [id]: values },
  };
}

/** Where the values of an id are, and what they are, if it has any */
function found(
  state: State,
  scope: ScopeName,
  id: string,
): { part: Part; values: Values } | undefined {
  return PARTS.flatMap((part) => {
    const values = state[part][scope][id];
    return values === undefined ? [] : [{ part, values }];
  })[0];
}

/**
 * The state with the values of an id changed in each part that has any (no part does but where
 * a version stopped halfway); a part that has none is left as it is, and not written
 */
const inEachPart = (
  state: State,
  scope: ScopeName,
  id: string,
  next: (values: Values) => Values | undefined,
): State =>
  PARTS.reduce((changed, part) => {
    const values = changed[part][scope][id];
    return values === undefined
      ? changed
      : {
          ...changed,
          [part]: withValues(changed[part], scope, id, next(values)),
        };
  }, state);

/**
 * Chromium has no `browser.sessions` values, so they are kept in the
 * extension's storage instead. Calls take turns, because each one reads and
 * writes everything. Told how to know a private window or tab, it keeps their
 * values apart from the others, so that none of them is kept for a window
 * that comes back; the add-on lets go of them when they close (`closed-windows.ts`).
 */
export function createSessionsEmulation(
  getStorage: () => StorageArea,
  exclusively: Exclusively = createExclusively(undefined),
  isPrivate?: IsPrivate,
): SessionsEmulation {
  async function load(): Promise<State> {
    const stored = await getStorage().get([STORAGE_KEY, PRIVATE_KEY]);
    return {
      apart: dataIn(stored[PRIVATE_KEY]),
      kept: dataIn(stored[STORAGE_KEY]),
    };
  }

  // Changes the state in one write, of the parts that changed; nothing is written for none
  const change = (update: (state: State) => Promise<State> | State) =>
    exclusively(async () => {
      const before = await load();
      const after = await update(before);
      const changed = PARTS.filter((part) => after[part] !== before[part]);
      if (changed.length > 0) {
        await getStorage().set(
          Object.fromEntries(
            changed.map((part) => [KEY_OF[part], after[part]]),
          ),
        );
      }
    });

  // Where the first value of an id goes. What cannot be asked about is not kept past the
  // browser's session: it is gone, or about to be.
  async function partFor(scope: ScopeName, id: number): Promise<Part> {
    if (isPrivate === undefined) {
      return 'kept';
    }
    return (await isPrivate(scope, id).catch(() => true)) ? 'apart' : 'kept';
  }

  const read = (scope: ScopeName, id: number, key: string): Promise<unknown> =>
    exclusively(
      async () => found(await load(), scope, String(id))?.values[key],
    );

  const write = (
    scope: ScopeName,
    id: number,
    key: string,
    value: unknown,
  ): Promise<void> =>
    change(async (state) => {
      const at = found(state, scope, String(id));
      const part = at?.part ?? (await partFor(scope, id));
      return {
        ...state,
        [part]: withValues(state[part], scope, String(id), {
          ...at?.values,
          [key]: value,
        }),
      };
    });

  // An entry with nothing left in it is no entry
  const erase = (scope: ScopeName, id: number, key: string): Promise<void> =>
    change((state) =>
      inEachPart(state, scope, String(id), (values) => {
        const left = Object.entries(values).filter(([name]) => name !== key);
        return left.length === 0 ? undefined : Object.fromEntries(left);
      }),
    );

  const forget = (scope: ScopeName, id: number): Promise<void> =>
    change((state) => inEachPart(state, scope, String(id), () => undefined));

  const ids = (part: Part, scope: ScopeName): Promise<number[]> =>
    exclusively(async () =>
      Object.keys((await load())[part][scope])
        .map(Number)
        .filter((id) => Number.isInteger(id)),
    );

  // What a private window or tab has kept apart already is newer than what it has with the others
  const moveApart = (
    state: State,
    scope: ScopeName,
    moving: readonly number[],
  ) =>
    moving
      .map(String)
      .filter((id) => state.kept[scope][id] !== undefined)
      .reduce(
        (moved, id) => ({
          apart: withValues(
            moved.apart,
            scope,
            id,
            moved.apart[scope][id] ?? moved.kept[scope][id],
          ),
          kept: withValues(moved.kept, scope, id, undefined),
        }),
        state,
      );

  return {
    windowIds: () => ids('kept', 'windows'),
    tabIds: () => ids('kept', 'tabs'),
    privateWindowIds: () => ids('apart', 'windows'),
    privateTabIds: () => ids('apart', 'tabs'),
    setPrivate: (windowIds, tabIds) =>
      change((state) =>
        moveApart(moveApart(state, 'windows', windowIds), 'tabs', tabIds),
      ),
    removeWindow: (windowId) => forget('windows', windowId),
    removeTab: (tabId) => forget('tabs', tabId),
    getTabValue: (tabId, key) => read('tabs', tabId, key),
    setTabValue: (tabId, key, value) => write('tabs', tabId, key, value),
    removeTabValue: (tabId, key) => erase('tabs', tabId, key),
    getWindowValue: (windowId, key) => read('windows', windowId, key),
    setWindowValue: (windowId, key, value) =>
      write('windows', windowId, key, value),
    removeWindowValue: (windowId, key) => erase('windows', windowId, key),
  };
}
