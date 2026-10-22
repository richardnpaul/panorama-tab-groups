import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSessions } from '../../support/fake-sessions.js';

const sendMessage = vi.fn();
const query = vi.fn();
const getCurrent = vi.fn();
const getMessage = vi.fn();

const group = (id: number) => ({
  id,
  name: `Stored ${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
});

async function load({
  windowId = 4,
  stored = [group(1), group(2)],
}: { windowId?: number; stored?: readonly unknown[] | null } = {}) {
  vi.resetModules();
  const fake = createFakeSessions();
  if (stored !== null) {
    fake.windowValues.set(fake.slot(windowId, 'groups'), stored);
  }
  getCurrent.mockResolvedValue({ id: windowId });
  Object.assign(globalThis, {
    browser: {
      sessions: fake.api.sessions,
      windows: { getCurrent },
      runtime: { sendMessage },
      tabs: { query },
      i18n: { getMessage },
    },
  });
  const groups = await import('../../../src/js/view/groups.js');
  return { groups, ...fake };
}

describe('view/groups.ts', () => {
  beforeEach(() => {
    sendMessage.mockReset().mockResolvedValue({ success: true });
    query.mockReset().mockResolvedValue([]);
    getCurrent.mockReset();
    getMessage.mockReset().mockReturnValue('Group ');
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, 'browser');
  });

  describe('before init', () => {
    it('fails with a clear message instead of a TypeError', async () => {
      const { groups } = await load();

      expect(() => groups.getLength()).toThrow(
        'The groups have not been loaded yet',
      );
      expect(() => groups.getIds()).toThrow(
        'The groups have not been loaded yet',
      );
      expect(() => groups.get(1)).toThrow(
        'The groups have not been loaded yet',
      );
      expect(() => groups.getName(1)).toThrow(
        'The groups have not been loaded yet',
      );
      expect(() => {
        groups.forEach(vi.fn());
      }).toThrow('The groups have not been loaded yet');
      await expect(groups.create()).rejects.toThrow(
        'The groups have not been loaded yet',
      );
      await expect(groups.remove(1)).rejects.toThrow(
        'The groups have not been loaded yet',
      );
      await expect(groups.rename(1, 'x')).rejects.toThrow(
        'The groups have not been loaded yet',
      );
      await expect(
        groups.transform(1, { x: 0, y: 0, w: 1, h: 1 }),
      ).rejects.toThrow('The groups have not been loaded yet');
      await expect(groups.getActive()).rejects.toThrow(
        'The groups have not been loaded yet',
      );
      await expect(groups.setActive(1)).rejects.toThrow(
        'The groups have not been loaded yet',
      );
    });
  });

  describe('init', () => {
    it('loads the groups of the current window, without the system groups', async () => {
      const { groups } = await load({
        windowId: 4,
        stored: [group(-1), group(1), group(-2), group(2), group(-3)],
      });

      await groups.init();

      expect(groups.getIds()).toEqual([1, 2]);
      expect(groups.getLength()).toBe(2);
    });

    it('starts empty for a window with no stored groups', async () => {
      const { groups } = await load({ stored: null });

      await groups.init();

      expect(groups.getLength()).toBe(0);
    });

    it('fails when the browser does not say which window this is', async () => {
      const { groups } = await load();
      getCurrent.mockResolvedValue({});

      await expect(groups.init()).rejects.toThrow('No current window');
    });

    it('loads again from the browser when called again', async () => {
      const { groups, windowValues, slot } = await load();
      await groups.init();

      windowValues.set(slot(4, 'groups'), [group(9)]);
      await groups.init();

      expect(groups.getIds()).toEqual([9]);
    });
  });

  describe('after init', () => {
    it('finds groups by id and name', async () => {
      const { groups } = await load();
      await groups.init();

      expect(groups.get(2)?.name).toBe('Stored 2');
      expect(groups.get(99)).toBeNull();
      expect(groups.getName(1)).toBe('Stored 1');
      expect(groups.getName(99)).toBeUndefined();
    });

    it('goes through every group', async () => {
      const { groups } = await load();
      await groups.init();
      const ids: number[] = [];

      groups.forEach((each) => {
        ids.push(each.id);
      });

      expect(ids).toEqual([1, 2]);
    });

    it('makes a new group and keeps the ungrouped group when it saves', async () => {
      const { groups, windowValues, slot } = await load({ windowId: 4 });
      await groups.init();
      getMessage.mockReturnValue('Gruppe ');

      const created = await groups.create();

      expect(created.name).toBe(`Gruppe ${String(created.id)}`);
      expect(created.windowId).toBe(4);
      const saved = windowValues.get(slot(4, 'groups'));
      expect(
        Array.isArray(saved) ? saved.map((g: { id: number }) => g.id) : [],
      ).toEqual([1, 2, created.id, -2]);
      expect(sendMessage).toHaveBeenCalledWith({
        action: 'createMenuItem',
        groupId: String(created.id),
        groupName: created.name,
      });
    });

    it('renames and moves a group and saves it', async () => {
      const { groups, windowValues, slot } = await load();
      await groups.init();
      const rect = { x: 0.3, y: 0.3, w: 0.2, h: 0.2 };

      await groups.rename(1, 'Renamed');
      await groups.transform(1, rect);

      expect(groups.get(1)?.name).toBe('Renamed');
      expect(groups.get(1)?.rect).toBe(rect);
      expect(windowValues.get(slot(4, 'groups'))).toMatchObject([
        { id: 1, name: 'Renamed', rect },
        { id: 2 },
        { id: -2 },
      ]);
    });

    it('asks the background to delete a group along with its tabs', async () => {
      const { groups, tabValues, slot } = await load();
      await groups.init();
      query.mockResolvedValue([{ id: 101 }, { id: 102 }]);
      tabValues.set(slot(101, 'groupId'), 1);
      tabValues.set(slot(102, 'groupId'), 2);

      await groups.remove(1);

      expect(sendMessage).toHaveBeenCalledWith({
        action: 'deleteGroup',
        groupId: 1,
        windowId: 4,
        nativeGroupId: undefined,
        tabIds: [101],
      });
      expect(groups.getIds()).toEqual([2]);
    });

    it('logs to the console when the background cannot delete a group', async () => {
      const { groups } = await load();
      await groups.init();
      sendMessage.mockResolvedValue({ success: false, error: 'Failed' });
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      await groups.remove(1);

      expect(error).toHaveBeenCalledWith('Failed to delete group 1:', 'Failed');
      error.mockRestore();
    });

    it('keeps the active group in the window’s state', async () => {
      const { groups, windowValues, slot } = await load();
      await groups.init();

      await groups.setActive(2);

      await expect(groups.getActive()).resolves.toBe(2);
      expect(windowValues.get(slot(4, 'activeGroup'))).toBe(2);
    });
  });
});
