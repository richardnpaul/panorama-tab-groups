import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryViewTabs } from '../../../src/js/adapters/memory/view-tabs.js';
import { createGroupsStore } from '../../../src/js/app/groups-store.js';
import { createPopupService } from '../../../src/js/app/popup-service.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { ViewTab } from '../../../src/js/ports/view-tabs.js';

const WINDOW = 3;

const stored = (id: number, name: string): Group => ({
  id,
  name,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
});

const tab = (id: number, extra: Partial<ViewTab> = {}): ViewTab => ({
  id,
  windowId: WINDOW,
  index: id,
  title: `Tab ${String(id)}`,
  url: `https://t${String(id)}.test/`,
  favIconUrl: undefined,
  pinned: false,
  discarded: false,
  lastAccessed: 0,
  ...extra,
});

async function setUp(
  groups: readonly Group[] = [stored(1, 'One'), stored(2, 'Two')],
  tabs: readonly ViewTab[] = [],
  tabGroups: Record<number, number> = {},
) {
  const groupState = createMemoryGroupState();
  await groupState.setGroups(WINDOW, groups);
  await Promise.all(
    Object.entries(tabGroups).map(([tabId, groupId]) =>
      groupState.setTabGroup(Number(tabId), groupId),
    ),
  );
  const messaging = createMemoryMessaging();
  messaging.reply({ success: true });
  const viewTabs = createMemoryViewTabs(tabs);
  const store = await createGroupsStore(
    {
      groupState,
      messaging,
      tabs: createMemoryTabs(),
      clock: createMemoryClock(100),
      i18n: { getMessage: () => 'Group ' },
      logger: { error: vi.fn() },
    },
    WINDOW,
  );
  const service = createPopupService({
    groups: store,
    groupState,
    tabs: viewTabs,
  });
  return { service, store, groupState, viewTabs, messaging };
}

describe('app/popup-service.ts', () => {
  describe('snapshot', () => {
    it('lists the groups in order, each with the tabs in it', async () => {
      const { service } = await setUp(
        [stored(2, 'Two'), stored(1, 'One')],
        [tab(10), tab(11), tab(12), tab(13)],
        { 10: 1, 11: 2, 12: 1, 13: 2 },
      );

      const { groups } = await service.snapshot();

      expect(
        groups.map(({ id, name, tabs }) => [id, name, tabs.map((t) => t.id)]),
      ).toEqual([
        [2, 'Two', [11, 13]],
        [1, 'One', [10, 12]],
      ]);
    });

    it('leaves out the pinned tabs, and the tabs of no group', async () => {
      const { service } = await setUp(
        undefined,
        [tab(10, { pinned: true }), tab(11), tab(12)],
        { 10: 1, 11: 1 },
      );

      const { groups } = await service.snapshot();

      expect(groups[0]?.tabs.map((t) => t.id)).toEqual([11]);
      expect(groups[1]?.tabs).toEqual([]);
    });

    it('says which tab was used last and which group it is in', async () => {
      const { service } = await setUp(
        undefined,
        [
          tab(10, { lastAccessed: 5 }),
          tab(11, { lastAccessed: 9, pinned: true }),
          tab(12, { lastAccessed: 7 }),
        ],
        { 10: 1, 12: 2 },
      );

      await expect(service.snapshot()).resolves.toMatchObject({
        lastUsed: { tabId: 11, groupId: undefined },
      });
    });

    it('says the group of the tab used last', async () => {
      const { service } = await setUp(
        undefined,
        [tab(10, { lastAccessed: 5 }), tab(12, { lastAccessed: 7 })],
        { 10: 1, 12: 2 },
      );

      await expect(service.snapshot()).resolves.toMatchObject({
        lastUsed: { tabId: 12, groupId: 2 },
      });
    });

    it('says no tab was used last when none was used', async () => {
      const { service } = await setUp(undefined, [tab(10)], { 10: 1 });

      await expect(service.snapshot()).resolves.toMatchObject({
        lastUsed: null,
      });
    });

    it('lists the groups of a window with no tabs', async () => {
      const { service } = await setUp();

      const { groups, lastUsed } = await service.snapshot();

      expect(groups).toHaveLength(2);
      expect(lastUsed).toBeNull();
    });
  });

  describe('showGroup', () => {
    it('makes the group the active one and goes to its first tab', async () => {
      const { service, groupState, viewTabs } = await setUp(
        undefined,
        [tab(10), tab(11), tab(12)],
        { 10: 1, 11: 2, 12: 2 },
      );

      await service.showGroup(2);

      await expect(groupState.getActiveGroup(WINDOW)).resolves.toBe(2);
      expect(viewTabs.calls).toEqual(['activate 11']);
    });

    it('opens a new tab in a group that has none', async () => {
      const { service, groupState, viewTabs } = await setUp(
        undefined,
        [tab(10)],
        { 10: 1 },
      );

      await service.showGroup(2);

      await expect(groupState.getActiveGroup(WINDOW)).resolves.toBe(2);
      expect(viewTabs.calls).toEqual(['open new']);
      await expect(groupState.getTabGroup(500)).resolves.toBe(2);
    });

    it('does nothing for a group that is not there', async () => {
      const { service, groupState, viewTabs } = await setUp();

      await service.showGroup(9);

      expect(viewTabs.calls).toEqual([]);
      await expect(groupState.getActiveGroup(WINDOW)).resolves.toBeUndefined();
    });
  });

  describe('addNewTab', () => {
    it('makes the group the active one and opens a tab in it', async () => {
      const { service, groupState, viewTabs } = await setUp();
      viewTabs.nextTabId = 77;

      await service.addNewTab(1);

      await expect(groupState.getActiveGroup(WINDOW)).resolves.toBe(1);
      expect(viewTabs.calls).toEqual(['open new']);
      await expect(groupState.getTabGroup(77)).resolves.toBe(1);
    });

    it('makes the group active before the tab is opened', async () => {
      const { service, groupState, viewTabs } = await setUp();
      let activeWhenOpened: number | undefined;
      viewTabs.openNew = async () => {
        activeWhenOpened = await groupState.getActiveGroup(WINDOW);
        return 5;
      };

      await service.addNewTab(2);

      expect(activeWhenOpened).toBe(2);
    });
  });

  describe('createGroup', () => {
    it('makes a group in the next place of the grid, and makes it the active one', async () => {
      const { service, store, groupState } = await setUp();

      const id = await service.createGroup();

      expect(store.getIds()).toEqual([1, 2, id]);
      expect(store.get(id)?.rect).toEqual({ x: 0.5, y: 0, w: 0.25, h: 0.5 });
      await expect(groupState.getActiveGroup(WINDOW)).resolves.toBe(id);
      const saved = await groupState.getGroups(WINDOW);
      expect(saved?.[2]?.rect).toEqual({ x: 0.5, y: 0, w: 0.25, h: 0.5 });
    });

    it('fills the first place of the grid for the first group', async () => {
      const { service, store } = await setUp([]);

      const id = await service.createGroup();

      expect(store.get(id)?.rect).toEqual({ x: 0, y: 0, w: 0.25, h: 0.5 });
    });
  });

  describe('removeGroup', () => {
    it('removes the group and shows the first of those left', async () => {
      const { service, store, groupState, viewTabs, messaging } = await setUp(
        undefined,
        [tab(10), tab(11)],
        { 10: 1, 11: 2 },
      );

      await expect(service.removeGroup(2)).resolves.toBe(true);

      expect(store.getIds()).toEqual([1]);
      expect(messaging.sent).toEqual([
        expect.objectContaining({ action: 'deleteGroup', groupId: 2 }),
      ]);
      await expect(groupState.getActiveGroup(WINDOW)).resolves.toBe(1);
      expect(viewTabs.calls).toEqual(['activate 10']);
    });

    it('shows nothing when no group is left', async () => {
      const { service, store, viewTabs } = await setUp(
        [stored(1, 'One')],
        [tab(10)],
      );

      await expect(service.removeGroup(1)).resolves.toBe(true);

      expect(store.getIds()).toEqual([]);
      expect(viewTabs.calls).toEqual([]);
    });

    it('says the group is still there when it could not be removed', async () => {
      const { service, store, messaging, viewTabs } = await setUp();
      messaging.reply({ success: false, error: 'no' });

      await expect(service.removeGroup(1)).resolves.toBe(false);

      expect(store.getIds()).toEqual([1, 2]);
      expect(viewTabs.calls).toEqual([]);
    });
  });

  describe('the rest', () => {
    it('renames a group', async () => {
      const { service, store } = await setUp();

      await service.renameGroup(1, 'New name');

      expect(store.getName(1)).toBe('New name');
    });

    it('moves a group to the gap it is dropped in', async () => {
      const { service, store } = await setUp();

      await service.moveGroup(1, 2);

      expect(store.getIds()).toEqual([2, 1]);
    });

    it('opens and closes tabs', async () => {
      const { service, viewTabs } = await setUp(undefined, [tab(10), tab(11)]);

      await service.openTab(10);
      await service.closeTab(11);

      expect(viewTabs.calls).toEqual(['activate 10', 'close 11']);
    });
  });
});
