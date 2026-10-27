import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { withUngroupedGroup } from '../../../src/js/app/with-ungrouped-group.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import { describeGroupStateContract } from '../../support/group-state-contract.js';

const userGroup = (id: number): Group => ({
  id,
  name: `Group ${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
});

function setUp(now = 1234) {
  const inner = createMemoryGroupState();
  const clock = createMemoryClock(now);
  return { inner, clock, state: withUngroupedGroup(inner, clock) };
}

describe('app/with-ungrouped-group.ts', () => {
  it('stores the groups together with the group for ungrouped tabs', async () => {
    const { state } = setUp(1234);

    await state.setGroups(1, [userGroup(1), userGroup(2)]);

    const stored = await state.getGroups(1);
    expect(stored?.map(({ id }) => id)).toEqual([1, 2, -2]);
    expect(stored?.[2]).toMatchObject({
      name: 'Ungrouped Tabs',
      isSystemGroup: true,
      nativeGroupId: null,
      lastMoved: 1234,
    });
  });

  it('stamps a new system group with the time of the clock', async () => {
    const { state, clock } = setUp(1000);
    clock.set(9999);

    await state.setGroups(1, []);

    expect((await state.getGroups(1))?.[0]?.lastMoved).toBe(9999);
  });

  it('keeps an existing system group instead of adding another', async () => {
    const { state } = setUp();
    await state.setGroups(1, [userGroup(1)]);
    const withSystem = (await state.getGroups(1)) ?? [];

    await state.setGroups(1, withSystem);

    const stored = await state.getGroups(1);
    expect(stored?.filter(({ id }) => id === -2)).toHaveLength(1);
    expect(stored).toEqual(withSystem);
  });

  it('writes through to the state it wraps', async () => {
    const { state, inner } = setUp();

    await state.setGroups(4, [userGroup(1)]);

    expect((await inner.getGroups(4))?.map(({ id }) => id)).toEqual([1, -2]);
  });

  it('does not change the list it was given', async () => {
    const { state } = setUp();
    const groups = [userGroup(1)];

    await state.setGroups(1, groups);

    expect(groups).toEqual([userGroup(1)]);
  });

  it('passes everything else straight to the state it wraps', async () => {
    const inner = createMemoryGroupState();
    const spies = {
      getGroups: vi.spyOn(inner, 'getGroups'),
      getActiveGroup: vi.spyOn(inner, 'getActiveGroup'),
      setActiveGroup: vi.spyOn(inner, 'setActiveGroup'),
      getGroupIndex: vi.spyOn(inner, 'getGroupIndex'),
      setGroupIndex: vi.spyOn(inner, 'setGroupIndex'),
      getTabGroup: vi.spyOn(inner, 'getTabGroup'),
      setTabGroup: vi.spyOn(inner, 'setTabGroup'),
    };
    const state = withUngroupedGroup(inner, createMemoryClock());

    await state.getGroups(1);
    await state.setActiveGroup(2, 3);
    await state.getActiveGroup(4);
    await state.setGroupIndex(5, 6);
    await state.getGroupIndex(7);
    await state.setTabGroup(8, 9);
    await state.getTabGroup(10);

    expect(spies.getGroups).toHaveBeenCalledWith(1);
    expect(spies.setActiveGroup).toHaveBeenCalledWith(2, 3);
    expect(spies.getActiveGroup).toHaveBeenCalledWith(4);
    expect(spies.setGroupIndex).toHaveBeenCalledWith(5, 6);
    expect(spies.getGroupIndex).toHaveBeenCalledWith(7);
    expect(spies.setTabGroup).toHaveBeenCalledWith(8, 9);
    expect(spies.getTabGroup).toHaveBeenCalledWith(10);
  });
});

// Apart from the group it adds, it must behave like any other GroupState
describeGroupStateContract(
  'with the ungrouped group, for the parts it keeps',
  () => {
    const inner = createMemoryGroupState();
    const state = withUngroupedGroup(inner, createMemoryClock());
    return {
      ...state,
      // The contract stores its own groups and expects exactly those back
      setGroups: (windowId, groups) => inner.setGroups(windowId, groups),
    };
  },
);
