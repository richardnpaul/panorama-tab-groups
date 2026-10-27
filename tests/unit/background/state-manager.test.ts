import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSessions } from '../../support/fake-sessions.js';

async function loadStateManager() {
  vi.resetModules();
  const fake = createFakeSessions();
  Object.assign(globalThis, { browser: { sessions: fake.api.sessions } });
  const { stateManager } =
    await import('../../../src/js/background/StateManager.js');
  return { stateManager, ...fake };
}

describe('background/StateManager.ts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(globalThis, 'browser');
  });

  it('stores groups in the window’s sessions, with the ungrouped group added', async () => {
    const { stateManager, windowValues, slot } = await loadStateManager();

    await stateManager.setGroups(3, [
      {
        id: 1,
        name: 'One',
        containerId: 'firefox-default',
        rect: { x: 0, y: 0, w: 1, h: 1 },
      },
    ]);

    expect(windowValues.get(slot(3, 'groups'))).toEqual([
      {
        id: 1,
        name: 'One',
        containerId: 'firefox-default',
        rect: { x: 0, y: 0, w: 1, h: 1 },
      },
      {
        id: -2,
        name: 'Ungrouped Tabs',
        containerId: 'browser-default',
        nativeGroupId: null,
        rect: { x: 0, y: 0, w: 0, h: 0 },
        lastMoved: 1_700_000_000_000,
        isSystemGroup: true,
      },
    ]);
  });

  it('reads back what it stored, including the ungrouped group', async () => {
    const { stateManager } = await loadStateManager();

    await stateManager.setGroups(1, []);

    expect((await stateManager.getGroups(1))?.map(({ id }) => id)).toEqual([
      -2,
    ]);
  });

  it('keeps the active group, group index and tab groups', async () => {
    const { stateManager, windowValues, tabValues, slot } =
      await loadStateManager();

    await stateManager.setActiveGroup(2, 5);
    await stateManager.setGroupIndex(2, 6);
    await stateManager.setTabGroup(9, 7);

    expect(windowValues.get(slot(2, 'activeGroup'))).toBe(5);
    expect(windowValues.get(slot(2, 'groupIndex'))).toBe(6);
    expect(tabValues.get(slot(9, 'groupId'))).toBe(7);
    await expect(stateManager.getActiveGroup(2)).resolves.toBe(5);
    await expect(stateManager.getGroupIndex(2)).resolves.toBe(6);
    await expect(stateManager.getTabGroup(9)).resolves.toBe(7);
  });

  it.each([
    ['3', 3],
    ['12', 12],
    ['-1', -1],
    ['010', 10],
    ['7abc', 7],
    [4.9, 4],
  ])(
    'turns the group %j for a tab into the whole number %s',
    async (given, stored) => {
      const { stateManager, tabValues, slot } = await loadStateManager();

      await stateManager.setTabGroup(1, given);

      expect(tabValues.get(slot(1, 'groupId'))).toBe(stored);
    },
  );

  it('reads the browser that exists at the time of each call', async () => {
    const { stateManager } = await loadStateManager();
    await stateManager.setActiveGroup(1, 5);

    Object.assign(globalThis, {
      browser: { sessions: createFakeSessions().api.sessions },
    });

    await expect(stateManager.getActiveGroup(1)).resolves.toBeUndefined();
  });
});
