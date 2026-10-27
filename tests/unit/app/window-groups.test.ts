import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryToolbar } from '../../../src/js/adapters/memory/toolbar.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { withUngroupedGroup } from '../../../src/js/app/with-ungrouped-group.js';
import { createToolbarService } from '../../../src/js/app/toolbar-service.js';
import { createWindowGroups } from '../../../src/js/app/window-groups.js';
import type { Group } from '../../../src/js/ports/group-state.js';

const NOW = 1_700_000_000_000;

const group = (id: number): Group => ({
  id,
  name: `Existing ${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

function setUp({
  openingBackup = false,
  windowIds = [1],
  withUngrouped = true,
}: {
  openingBackup?: boolean;
  windowIds?: number[];
  withUngrouped?: boolean;
} = {}) {
  const clock = createMemoryClock(NOW);
  const memoryState = createMemoryGroupState();
  const groupState = withUngrouped
    ? withUngroupedGroup(memoryState, clock)
    : memoryState;
  const toolbar = createMemoryToolbar();
  const logger = { debug: vi.fn(), warn: vi.fn() };
  const windows = createMemoryWindows(windowIds[0] ?? 1);
  windowIds.slice(1).forEach((id) => {
    windows.open(id);
  });
  const order: string[] = [];
  const waitForInitialization = vi.fn(() => {
    order.push('waited');
    return Promise.resolve();
  });
  return {
    groups: createWindowGroups({
      groupState,
      windows,
      i18n: {
        getMessage: (name) => (name === 'defaultGroupName' ? 'Group ' : ''),
      },
      clock,
      toolbar: createToolbarService({ groupState, toolbar, logger }),
      waitForInitialization,
      isOpeningBackup: () => openingBackup,
      logger,
    }),
    groupState,
    toolbar,
    logger,
    waitForInitialization,
    order,
  };
}

describe('app/window-groups.ts', () => {
  describe('createGroupInWindow', () => {
    it('gives the window a group, named by number, and makes it the active one', async () => {
      const env = setUp();

      await env.groups.createGroupInWindow(1);

      expect(await env.groupState.getGroups(1)).toEqual([
        {
          id: 0,
          name: 'Group 0',
          containerId: 'browser-default',
          nativeGroupId: null,
          rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
          lastMoved: NOW,
        },
        expect.objectContaining({ id: -2, isSystemGroup: true }),
      ]);
      expect(await env.groupState.getActiveGroup(1)).toBe(0);
    });

    it('numbers the groups of a window one after the other', async () => {
      const env = setUp();

      await env.groups.createGroupInWindow(1);
      await env.groups.createGroupInWindow(1);

      expect((await env.groupState.getGroups(1))?.[0]?.id).toBe(1);
      expect(await env.groupState.getGroupIndex(1)).toBe(2);
      expect(await env.groupState.getActiveGroup(1)).toBe(1);
    });

    it('numbers the groups of each window by itself', async () => {
      const env = setUp();
      await env.groupState.setGroupIndex(2, 5);

      await env.groups.createGroupInWindow(1);
      await env.groups.createGroupInWindow(2);

      expect(await env.groupState.getActiveGroup(1)).toBe(0);
      expect(await env.groupState.getActiveGroup(2)).toBe(5);
    });

    it('does nothing while a backup is being opened', async () => {
      const env = setUp({ openingBackup: true });

      await env.groups.createGroupInWindow(1);

      expect(await env.groupState.getGroups(1)).toBeUndefined();
      expect(await env.groupState.getGroupIndex(1)).toBeUndefined();
      expect(await env.groupState.getActiveGroup(1)).toBeUndefined();
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Skipping creation of groups since we are opening backup',
      );
    });
  });

  describe('createGroupInWindowIfMissing', () => {
    it('waits for the start-up before it looks', async () => {
      const env = setUp();

      await env.groups.createGroupInWindowIfMissing(1);

      expect(env.waitForInitialization).toHaveBeenCalledTimes(1);
    });

    it('gives a window without groups its first, and says so', async () => {
      const env = setUp();

      await env.groups.createGroupInWindowIfMissing(1);

      expect(await env.groupState.getActiveGroup(1)).toBe(0);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'No groups found for window 1!',
      );
    });

    it('gives a window with an empty list of groups its first', async () => {
      const env = setUp({ withUngrouped: false });
      await env.groupState.setGroups(1, []);

      await env.groups.createGroupInWindowIfMissing(1);

      expect(await env.groupState.getActiveGroup(1)).toBe(0);
      expect((await env.groupState.getGroups(1))?.map(({ id }) => id)).toEqual([
        0,
      ]);
    });

    it('leaves the groups of a window that has some', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(4)]);
      await env.groupState.setActiveGroup(1, 4);

      await env.groups.createGroupInWindowIfMissing(1);

      expect((await env.groupState.getGroups(1))?.[0]?.name).toBe('Existing 4');
      expect(await env.groupState.getActiveGroup(1)).toBe(4);
      expect(env.logger.debug).not.toHaveBeenCalled();
    });

    it('shows that the window has no active group yet, either way', async () => {
      const env = setUp();
      await env.groupState.setGroups(1, [group(4)]);

      await env.groups.createGroupInWindowIfMissing(1);

      expect(env.toolbar.titles.get(1)).toBe('Active Group: None');
      expect(env.toolbar.badgeTexts.get(1)).toBe('1');
    });

    it('shows that after creating the group', async () => {
      const env = setUp();

      await env.groups.createGroupInWindowIfMissing(1);

      expect(env.toolbar.titles.get(1)).toBe('Active Group: None');
    });

    it('carries on when the toolbar cannot be changed', async () => {
      const env = setUp();
      env.toolbar.failWith(new Error('no window'));

      await env.groups.createGroupInWindowIfMissing(1);

      expect(env.logger.warn).toHaveBeenCalledTimes(1);
    });
  });

  describe('setupWindows', () => {
    it('gives every window that lacks groups its first', async () => {
      const env = setUp({ windowIds: [1, 2, 3] });
      await env.groupState.setGroups(2, [group(9)]);

      await env.groups.setupWindows();

      expect(await env.groupState.getActiveGroup(1)).toBe(0);
      expect(await env.groupState.getActiveGroup(2)).toBeUndefined();
      expect(await env.groupState.getActiveGroup(3)).toBe(0);
      expect(env.waitForInitialization).toHaveBeenCalledTimes(3);
    });
  });
});
