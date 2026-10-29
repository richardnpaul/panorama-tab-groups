import { type Lab } from './lab.js';

/** A tab as the browser reports it, with what the tests look at */
export interface WorldTab {
  id: number;
  windowId: number;
  groupId: number;
  title: string;
  hidden: boolean;
  index: number;
}

export interface WorldGroup {
  id: number;
  windowId: number;
  title: string;
  collapsed: boolean;
}

const isNumber = (value: unknown): value is number => typeof value === 'number';
const isString = (value: unknown): value is string => typeof value === 'string';
const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

function asTabs(value: unknown): WorldTab[] {
  if (!Array.isArray(value)) {
    throw new Error('tabs.query did not give a list');
  }
  return value.flatMap((tab: unknown) =>
    isObject(tab) &&
    isNumber(tab.id) &&
    isNumber(tab.windowId) &&
    isNumber(tab.groupId) &&
    isNumber(tab.index) &&
    isBool(tab.hidden)
      ? [
          {
            id: tab.id,
            windowId: tab.windowId,
            groupId: tab.groupId,
            index: tab.index,
            hidden: tab.hidden,
            title: isString(tab.title) ? tab.title : '',
          },
        ]
      : [],
  );
}

function asGroups(value: unknown): WorldGroup[] {
  if (!Array.isArray(value)) {
    throw new Error('tabGroups.query did not give a list');
  }
  return value.flatMap((group: unknown) =>
    isObject(group) &&
    isNumber(group.id) &&
    isNumber(group.windowId) &&
    isBool(group.collapsed)
      ? [
          {
            id: group.id,
            windowId: group.windowId,
            collapsed: group.collapsed,
            title: isString(group.title) ? group.title : '',
          },
        ]
      : [],
  );
}

/** A number that an API gave, or a failure that says what it gave instead */
export function numberFrom(value: unknown, what: string): number {
  if (!isNumber(value)) {
    throw new Error(`${what} gave ${JSON.stringify(value)}, not a number`);
  }
  return value;
}

/** What the browser has, as seen by the probe of a lab */
export function worldOf(lab: Lab, probeName: string) {
  const probe = lab.probe(probeName);
  return {
    tabs: async (): Promise<WorldTab[]> =>
      asTabs(await probe.call('tabs.query', {})),
    groups: async (): Promise<WorldGroup[]> =>
      asGroups(await probe.call('tabGroups.query', {})),

    /** The windows, by id, in the order they are listed */
    windowIds: async (): Promise<number[]> => {
      const windows = await probe.call('windows.getAll', {});
      return Array.isArray(windows)
        ? windows.flatMap((window: unknown) =>
            isObject(window) && isNumber(window.id) ? [window.id] : [],
          )
        : [];
    },

    /** Open more tabs in a window, with these names as their titles */
    async addTabs(windowId: number, names: readonly string[]): Promise<void> {
      await names.reduce(async (previous, name) => {
        await previous;
        await probe.call('tabs.create', {
          windowId,
          url: lab.pageUrl(name),
          active: false,
        });
      }, Promise.resolve());
    },

    /** Open a window with tabs of these names, which have these as titles; the ids of the tabs, in order */
    async openWindow(names: readonly string[]): Promise<{
      windowId: number;
      tabIds: number[];
    }> {
      const [first, ...rest] = names;
      const created = await probe.call('windows.create', {
        url: lab.pageUrl(first ?? 'blank'),
      });
      if (!isObject(created) || !isNumber(created.id)) {
        throw new Error('windows.create gave no window');
      }
      const windowId = created.id;
      await this.addTabs(windowId, rest);
      const tabs = (await this.tabs())
        .filter((tab) => tab.windowId === windowId)
        .sort((first2, second) => first2.index - second.index);
      return { windowId, tabIds: tabs.map(({ id }) => id) };
    },
  };
}
