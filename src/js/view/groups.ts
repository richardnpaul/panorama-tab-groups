// The view's access to its window's groups. The state lives in a store (see
// app/groups-store.ts); this module only gives the other view modules the
// functions they already call, and builds the store from the browser.
import { createBrowserI18n } from '../adapters/browser/i18n.js';
import { createBrowserMessaging } from '../adapters/browser/messaging.js';
import { createBrowserTabs } from '../adapters/browser/tabs.js';
import { createBrowserWindows } from '../adapters/browser/windows.js';
import { systemClock } from '../adapters/system/clock.js';
import { createGroupsStore, type GroupsStore } from '../app/groups-store.js';
import { stateManager } from '../background/StateManager.js';
import type { Group, Rect } from '../ports/group-state.js';

let store: GroupsStore | undefined;

function loaded(): GroupsStore {
  if (store === undefined) {
    throw new Error('The groups have not been loaded yet');
  }
  return store;
}

export async function init(): Promise<void> {
  store = await createGroupsStore(
    {
      groupState: stateManager,
      messaging: createBrowserMessaging(() => browser),
      tabs: createBrowserTabs(() => browser),
      clock: systemClock,
      i18n: createBrowserI18n(() => browser),
      logger: console,
    },
    await createBrowserWindows(() => browser).currentWindowId(),
  );
}

export const getLength = (): number => loaded().getLength();
export const getIds = (): number[] => loaded().getIds();
export const get = (id: number): Group | null => loaded().get(id);
export const getName = (id: number): string | undefined => loaded().getName(id);
export const forEach = (callback: (group: Group) => void): void => {
  loaded().forEach(callback);
};
export const create = async (): Promise<Group> => loaded().create();
export const remove = async (id: number): Promise<void> => loaded().remove(id);
export const rename = async (id: number, newName: string): Promise<void> =>
  loaded().rename(id, newName);
export const transform = async (id: number, rect: Rect): Promise<void> =>
  loaded().transform(id, rect);
export const getActive = async (): Promise<number | undefined> =>
  loaded().getActive();
export const setActive = async (id: number): Promise<void> =>
  loaded().setActive(id);
