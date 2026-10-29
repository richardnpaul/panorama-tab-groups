import { beforeEach, describe, expect, it } from 'vitest';
import {
  type BrowserEvent,
  type BrowserModel,
  createBrowserModel,
} from '../../support/world/browser-model.js';

// Each of these is a fact about the real Firefox that tests/e2e/firefox-facts.spec.ts
// checks against a real one; this is the browser the unit tests of the journeys run in.
describe('the model of a browser (tests/support/world)', () => {
  let events: BrowserEvent[];
  let model: BrowserModel;

  const kinds = (): string[] => events.map(({ type }) => type);

  beforeEach(() => {
    events = [];
    model = createBrowserModel((event) => events.push(event));
  });

  describe('windows and tabs', () => {
    it('opens a window with a tab for each address, the first in front, and the window has the focus', () => {
      const first = model.seedWindow(['a']);
      const second = model.openWindow(['b', 'c']);

      expect(model.focused()).toBe(second.windowId);
      expect(model.tabsOf(second.windowId).map(({ url }) => url)).toEqual([
        'b',
        'c',
      ]);
      expect(model.tabsOf(second.windowId).map(({ active }) => active)).toEqual(
        [true, false],
      );
      expect(first.windowId).not.toBe(second.windowId);
    });

    it('opens a window with a blank tab when it is given no address', () => {
      const { windowId } = model.openWindow([]);

      expect(model.tabsOf(windowId).map(({ url }) => url)).toEqual([
        'about:blank',
      ]);
    });

    it('says nothing of the windows and tabs that were there before', () => {
      model.seedWindow(['a', 'b']);

      expect(events).toEqual([]);
    });

    it('says a window and its tabs were created, in that order', () => {
      model.openWindow(['a', 'b']);

      expect(kinds()).toEqual(['windowCreated', 'tabCreated', 'tabCreated']);
    });

    it('adds a tab at the end, and brings it to the front only when asked', () => {
      const { windowId, tabIds } = model.seedWindow(['a']);

      const quiet = model.openTab(windowId, 'b');
      const front = model.openTab(windowId, 'c', true);

      expect(model.tabsOf(windowId).map(({ id }) => id)).toEqual([
        ...tabIds,
        quiet,
        front,
      ]);
      expect(model.tabs.get(quiet)?.active).toBe(false);
      expect(model.tabs.get(front)?.active).toBe(true);
      expect(kinds()).toEqual(['tabCreated', 'tabCreated', 'tabActivated']);
    });

    it('does not say a tab was activated that already was', () => {
      const { tabIds } = model.seedWindow(['a']);

      model.activateTab(tabIds[0] ?? 0);

      expect(events).toEqual([]);
    });

    it('closes a tab, says so, and closes the window when it had no other', () => {
      const { windowId, tabIds } = model.seedWindow(['a']);

      model.closeTab(tabIds[0] ?? 0);

      expect(kinds()).toEqual(['tabRemoved']);
      expect(model.windows.has(windowId)).toBe(false);
    });

    it('moves the focus to a window that is left when the one that had it closes', () => {
      const first = model.seedWindow(['a']);
      const second = model.openWindow(['b']);

      model.closeTab(second.tabIds[0] ?? 0);

      expect(model.focused()).toBe(first.windowId);
    });

    it('brings the next tab to the front when the one in front is closed, and says it was activated', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);

      model.closeTab(tabIds[0] ?? 0);

      expect(model.tabsOf(windowId).map(({ active }) => active)).toEqual([
        true,
      ]);
      // The next tab is brought to the front before the one that was in front is taken away
      expect(kinds()).toEqual(['tabActivated', 'tabRemoved']);
    });

    it('says nothing of an activation when the tab that is closed was not in front, or was the only one', () => {
      const { tabIds } = model.seedWindow(['a', 'b']);
      model.seedWindow(['c']);

      model.closeTab(tabIds[1] ?? 0);

      expect(kinds()).toEqual(['tabRemoved']);
    });
    it('refuses what is not there', () => {
      expect(() => {
        model.closeTab(99);
      }).toThrow('No tab with id: 99');
      expect(() => {
        model.openTab(99, 'a');
      }).toThrow('No window with id: 99');
      expect(() => {
        model.focusWindow(99);
      }).toThrow('No window with id: 99');
    });

    it('puts a tab after the others of its window', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b', 'c']);

      model.moveToEnd(tabIds[0] ?? 0);

      expect(model.tabsOf(windowId).map(({ id }) => id)).toEqual([
        tabIds[1],
        tabIds[2],
        tabIds[0],
      ]);
    });

    it('shows a hidden tab that is brought to the front', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      model.hide([tabIds[1] ?? 0]);

      model.activateTab(tabIds[1] ?? 0);

      expect(model.tabsOf(windowId).map(({ hidden }) => hidden)).toEqual([
        false,
        false,
      ]);
    });
  });

  describe('moving a tab to another window', () => {
    it('says it left the one and came to the other, and closes the window it leaves empty', () => {
      const first = model.seedWindow(['a']);
      const second = model.seedWindow(['b']);
      const [tabId = 0] = first.tabIds;

      model.moveTab(tabId, second.windowId);

      expect(kinds()).toEqual(['tabDetached', 'tabAttached']);
      expect(model.tabs.get(tabId)?.windowId).toBe(second.windowId);
      expect(model.windows.has(first.windowId)).toBe(false);
    });

    it('does nothing for a tab that is in the window already', () => {
      const { windowId, tabIds } = model.seedWindow(['a']);

      model.moveTab(tabIds[0] ?? 0, windowId);

      expect(events).toEqual([]);
    });

    it('takes the tab out of its group, which stays with the others (a fact of Firefox)', () => {
      const first = model.seedWindow(['a', 'b', 'c']);
      const other = model.seedWindow(['d']);
      const [one = 0, two = 0] = first.tabIds;
      const group = model.group([one, two], { windowId: first.windowId });
      events.length = 0;

      model.moveTab(one, other.windowId);

      expect(model.tabs.get(one)).toMatchObject({
        windowId: other.windowId,
        groupId: -1,
      });
      expect(model.tabs.get(two)?.groupId).toBe(group);
      expect([...model.groups.keys()]).toEqual([group]);
      // The tab was the one in front of its window, so the next one is brought to the front
      expect(kinds()).toEqual([
        'tabDetached',
        'tabActivated',
        'tabAttached',
        'tabUpdated',
      ]);
    });
  });

  describe('tab groups', () => {
    it('gives a group an id that is large', () => {
      const { windowId, tabIds } = model.seedWindow(['a']);

      const id = model.group(tabIds, { windowId });

      expect(id).toBeGreaterThan(2 ** 32);
      expect(Number.isSafeInteger(id)).toBe(true);
    });

    it('makes the group in the window it is told, and the tabs stay (a fact of Firefox)', () => {
      const first = model.seedWindow(['a', 'b']);
      model.seedWindow(['c']);

      const id = model.group(first.tabIds, { windowId: first.windowId });

      expect(model.groups.get(id)?.windowId).toBe(first.windowId);
      expect(first.tabIds.map((tab) => model.tabs.get(tab)?.windowId)).toEqual([
        first.windowId,
        first.windowId,
      ]);
    });

    it('makes the group in the window that has the focus when it is not told, and moves the tabs there (a fact of Firefox)', () => {
      const first = model.seedWindow(['a', 'b']);
      const second = model.seedWindow(['c']);

      const id = model.group(first.tabIds);

      expect(model.groups.get(id)?.windowId).toBe(second.windowId);
      expect(first.tabIds.map((tab) => model.tabs.get(tab)?.windowId)).toEqual([
        second.windowId,
        second.windowId,
      ]);
      // and the window that has no tab left is closed
      expect(model.windows.has(first.windowId)).toBe(false);
    });

    it('says a tab was updated for each tab that joins a group', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      events.length = 0;

      model.group(tabIds, { windowId });

      expect(kinds()).toEqual(['tabUpdated', 'tabUpdated']);
    });

    it('puts a hidden tab in a group, and the tab stays hidden (a fact of Firefox)', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      model.openTab(windowId, 'c');
      const [front = 0, back = 0] =
        tabIds.length > 1 ? tabIds : [tabIds[0] ?? 0, 0];
      const hiddenId = model.openTab(windowId, 'd');
      model.hide([hiddenId]);

      const id = model.group(
        [hiddenId, front, back].filter((tab) => tab !== 0),
        {
          windowId,
        },
      );

      expect(model.tabs.get(hiddenId)).toMatchObject({
        groupId: id,
        hidden: true,
      });
    });

    it('joins a group by its id for a tab of its window, and refuses a tab of another (a fact of Firefox)', () => {
      const first = model.seedWindow(['a', 'b']);
      const second = model.seedWindow(['c']);
      const id = model.group([first.tabIds[0] ?? 0], {
        windowId: first.windowId,
      });

      model.group([first.tabIds[1] ?? 0], { groupId: id });

      expect(model.tabs.get(first.tabIds[1] ?? 0)?.groupId).toBe(id);
      expect(() => model.group(second.tabIds, { groupId: id })).toThrow(
        'An unexpected error occurred',
      );
    });

    it('refuses to join a group that is not there, and to make a group of no tabs', () => {
      const { tabIds } = model.seedWindow(['a']);

      expect(() => model.group(tabIds, { groupId: 5 })).toThrow(
        'No group with id: 5',
      );
      expect(() => model.group([])).toThrow('have at least 1 items');
    });

    it('lets the only tab of a window be grouped, and the window stays (a fact of Firefox)', () => {
      const { windowId, tabIds } = model.seedWindow(['a']);

      model.group(tabIds, { windowId });

      expect(model.windows.has(windowId)).toBe(true);
      expect(model.groups.size).toBe(1);
    });

    it('removes a group when its last tab is taken out of it, and says so (a fact of Firefox)', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      const [one = 0, two = 0] = tabIds;
      const id = model.group([one, two], { windowId });
      events.length = 0;

      model.ungroup([one]);
      expect([...model.groups.keys()]).toEqual([id]);
      model.ungroup([two]);

      expect(model.groups.size).toBe(0);
      expect(kinds()).toEqual(['tabUpdated', 'tabUpdated', 'groupRemoved']);
    });

    it('removes a group when its last tab is closed (a fact of Firefox)', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      model.group([tabIds[1] ?? 0], { windowId });
      events.length = 0;

      model.closeTab(tabIds[1] ?? 0);

      expect(model.groups.size).toBe(0);
      expect(kinds()).toEqual(['tabRemoved', 'groupRemoved']);
    });

    it('moves a tab from one group to another and removes the one it leaves empty', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      const first = model.group([tabIds[0] ?? 0], { windowId });
      const second = model.group([tabIds[1] ?? 0], { windowId });

      model.group([tabIds[0] ?? 0], { groupId: second });

      expect(model.groups.has(first)).toBe(false);
      expect(model.tabs.get(tabIds[0] ?? 0)?.groupId).toBe(second);
    });

    it('changes the name, the colour and whether it is collapsed, and says so; and refuses a group that is gone', () => {
      const { windowId, tabIds } = model.seedWindow(['a']);
      const id = model.group(tabIds, { windowId });
      events.length = 0;

      model.updateGroup(id, { title: 'Work', color: 'blue', collapsed: true });

      expect(model.groups.get(id)).toMatchObject({
        title: 'Work',
        color: 'blue',
        collapsed: true,
      });
      expect(kinds()).toEqual(['groupUpdated']);
      expect(() => {
        model.updateGroup(1, { title: 'x' });
      }).toThrow('No group with id: 1');
    });

    it('collapses a group that has a hidden tab in it (a fact of Firefox)', () => {
      const { windowId, tabIds } = model.seedWindow(['a']);
      const hiddenId = model.openTab(windowId, 'b');
      model.hide([hiddenId]);
      const id = model.group([hiddenId, tabIds[0] ?? 0], { windowId });

      model.updateGroup(id, { collapsed: true });

      expect(model.groups.get(id)?.collapsed).toBe(true);
    });
  });

  describe('hiding', () => {
    it('does not hide the tab in front, and says which it hid (a fact of Firefox)', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);

      expect(model.hide(tabIds)).toEqual([tabIds[1]]);

      expect(model.tabsOf(windowId).map(({ hidden }) => hidden)).toEqual([
        false,
        true,
      ]);
    });

    it('shows hidden tabs', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      model.hide(tabIds);

      model.show(tabIds);

      expect(model.tabsOf(windowId).map(({ hidden }) => hidden)).toEqual([
        false,
        false,
      ]);
    });
  });

  describe('closing a window and restoring it', () => {
    it('closes a window with all its tabs and its groups, and says so', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      model.seedWindow(['c']);
      model.group(tabIds, { windowId });
      events.length = 0;

      model.closeWindow(windowId);

      expect(model.windows.has(windowId)).toBe(false);
      expect(model.groups.size).toBe(0);
      expect(kinds().filter((kind) => kind === 'tabRemoved')).toHaveLength(2);
      expect(kinds()).toContain('groupRemoved');
    });

    it('restores the window last closed, with new ids for it and its tabs, and the focus (a fact of Firefox)', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b']);
      model.seedWindow(['c']);
      model.closeWindow(windowId);
      events.length = 0;

      const restored = model.restoreWindow();

      expect(restored?.windowId).not.toBe(windowId);
      expect(restored?.tabIds.some((id) => tabIds.includes(id))).toBe(false);
      expect(model.focused()).toBe(restored?.windowId);
      expect(
        model.tabsOf(restored?.windowId ?? 0).map(({ url }) => url),
      ).toEqual(['a', 'b']);
      expect(kinds()).toEqual(['windowCreated', 'tabCreated', 'tabCreated']);
    });

    it('restores the group with the same id, name and colour, and what the extension kept (a fact of Firefox)', () => {
      const { windowId, tabIds } = model.seedWindow(['a', 'b', 'c']);
      model.seedWindow(['d']);
      const [one = 0, two = 0, three = 0] = tabIds;
      const group = model.group([one, two], { windowId });
      model.updateGroup(group, { title: 'Work', color: 'blue' });
      const tab = model.tabs.get(one);
      const window = model.windows.get(windowId);
      if (tab !== undefined && window !== undefined) {
        tab.values.groupId = 7;
        window.values.groups = [1];
      }
      model.closeWindow(windowId);

      const restored = model.restoreWindow();

      const tabs = model.tabsOf(restored?.windowId ?? 0);
      expect(model.groups.get(group)).toMatchObject({
        title: 'Work',
        color: 'blue',
        windowId: restored?.windowId,
      });
      expect(tabs.map((each) => each.groupId)).toEqual([group, group, -1]);
      expect(tabs.map((each) => each.values.groupId)).toEqual([
        7,
        undefined,
        undefined,
      ]);
      expect(model.windows.get(restored?.windowId ?? 0)?.values.groups).toEqual(
        [1],
      );
      expect(three).toBeDefined();
    });

    it('restores the windows in the order the closing was, last first', () => {
      const first = model.seedWindow(['a']);
      const second = model.seedWindow(['b']);
      model.seedWindow(['c']);
      model.closeWindow(first.windowId);
      model.closeWindow(second.windowId);

      const one = model.restoreWindow();
      const two = model.restoreWindow();

      expect(model.tabsOf(one?.windowId ?? 0).map(({ url }) => url)).toEqual([
        'b',
      ]);
      expect(model.tabsOf(two?.windowId ?? 0).map(({ url }) => url)).toEqual([
        'a',
      ]);
    });

    it('restores nothing when no window was closed', () => {
      model.seedWindow(['a']);

      expect(model.restoreWindow()).toBeUndefined();
    });
  });

  describe('restarting', () => {
    it('gives windows, tabs and groups new ids, and they keep what they hold', () => {
      const first = model.seedWindow(['a', 'b']);
      model.seedWindow(['c']);
      const [one = 0, two = 0] = first.tabIds;
      const group = model.group([one, two], { windowId: first.windowId });
      model.updateGroup(group, { title: 'Work' });
      const tab = model.tabs.get(one);
      if (tab !== undefined) {
        tab.values.groupId = 4;
      }
      const window = model.windows.get(first.windowId);
      if (window !== undefined) {
        window.values.groups = [1];
      }

      model.restart();

      const [newGroup] = [...model.groups.values()];
      expect(model.windows.has(first.windowId)).toBe(false);
      expect(model.tabs.has(one)).toBe(false);
      expect(model.groups.has(group)).toBe(false);
      expect(newGroup).toMatchObject({ title: 'Work' });
      const grouped = [...model.tabs.values()].filter(
        ({ groupId }) => groupId === newGroup?.id,
      );
      expect(grouped).toHaveLength(2);
      expect(grouped[0]?.windowId).toBe(newGroup?.windowId);
      expect(grouped.map(({ values }) => values.groupId)).toEqual([
        4,
        undefined,
      ]);
      expect(model.windows.get(newGroup?.windowId ?? 0)?.values.groups).toEqual(
        [1],
      );
    });

    it('keeps the order of the tabs of a window, and which window has the focus', () => {
      const first = model.seedWindow(['a', 'b', 'c']);
      const second = model.seedWindow(['d']);

      model.restart();

      const urls = [...model.windows.values()].map((window) =>
        model.tabsOf(window.id).map(({ url }) => url),
      );
      expect(urls).toEqual([['a', 'b', 'c'], ['d']]);
      expect(model.tabsOf(model.focused()).map(({ url }) => url)).toEqual([
        'd',
      ]);
      expect(first.windowId).not.toBe(second.windowId);
    });

    it('says nothing, as the add-on is not running while the browser is closed', () => {
      model.seedWindow(['a']);

      model.restart();

      expect(events).toEqual([]);
    });
  });
});
