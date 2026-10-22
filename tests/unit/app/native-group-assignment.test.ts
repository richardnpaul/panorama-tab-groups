import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryNativeGroups } from '../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createNativeGroupAssignment } from '../../../src/js/app/native-group-assignment.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';

const WINDOW = 3;
const VIEW = 'moz-extension://id/view.html';

const group = (id: number, name = `G${String(id)}`): Group => ({
  id,
  name,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

const tab = (id: number, url = `https://site${String(id)}/`): TabDetails => ({
  id,
  windowId: WINDOW,
  active: false,
  pinned: false,
  url,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
});

async function setUp(
  tabsInWindow: { tab: TabDetails; group: number | undefined }[],
) {
  const tabs = createMemoryTabs();
  tabs.setDetails(tabsInWindow.map((entry) => entry.tab));
  const groupState = createMemoryGroupState();
  await Promise.all(
    tabsInWindow.flatMap(({ tab: { id }, group: groupId }) =>
      groupId === undefined ? [] : [groupState.setTabGroup(id, groupId)],
    ),
  );
  const windows = createMemoryWindows(WINDOW);
  const nativeGroups = createMemoryNativeGroups([], WINDOW);
  const logger = { debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const groups = [group(1, 'Work'), group(2, '')];
  await groupState.setGroups(WINDOW, groups);
  return {
    service: createNativeGroupAssignment({
      tabs,
      windows,
      groupState,
      nativeGroups,
      viewUrl: VIEW,
      logger,
    }),
    tabs,
    groupState,
    windows,
    nativeGroups,
    logger,
    groups,
  };
}

describe('app/native-group-assignment.ts', () => {
  it('puts the tabs of the group into a new native group and records it', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 2 },
      { tab: tab(3), group: 1 },
      { tab: tab(4), group: undefined },
    ]);

    const outcome = await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1, 'Work'),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(outcome).toEqual({ kind: 'created', nativeGroupId: 1000 });
    expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([1, 3]);
    expect(
      (await env.groupState.getGroups(WINDOW))?.map((g) => g.nativeGroupId),
    ).toEqual([1000, undefined]);
    expect(env.logger.error).not.toHaveBeenCalled();
    expect(env.logger.warn).not.toHaveBeenCalled();
    expect(env.logger.debug).toHaveBeenCalledWith(
      '[TabCreated] Created native group 1000 for panorama group 1 with 2 tabs in window 3',
    );
  });

  it('gives the native group the name and colour of the group', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
    ]);

    await env.service.createNativeGroup({
      windowId: WINDOW,
      group: env.groups[0] ?? group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(env.nativeGroups.groups.get(1000)).toEqual({
      windowId: WINDOW,
      tabIds: [1, 2],
      title: 'Work',
      color: 'blue',
    });
  });

  it('names a group that has no name after its number', async () => {
    const env = await setUp([
      { tab: tab(1), group: 2 },
      { tab: tab(2), group: 2 },
    ]);

    await env.service.createNativeGroup({
      windowId: WINDOW,
      group: env.groups[1] ?? group(2),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(env.nativeGroups.groups.get(1000)?.title).toBe('Group 2');
  });

  it('only changes the group that was given in the groups it saves', async () => {
    const env = await setUp([
      { tab: tab(1), group: 2 },
      { tab: tab(2), group: undefined },
    ]);
    const given = [group(1, 'Work'), group(2, ''), group(5, 'Other')];

    await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(2, ''),
      groups: given,
      label: 'TabActivated',
    });

    expect(
      (await env.groupState.getGroups(WINDOW))?.map((g) => g.nativeGroupId),
    ).toEqual([undefined, 1000, undefined]);
    expect(given.map((g) => g.nativeGroupId)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('does nothing when the group has no tab in the window', async () => {
    const env = await setUp([{ tab: tab(1), group: 2 }]);

    const outcome = await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(outcome).toEqual({ kind: 'no-tabs' });
    expect(env.nativeGroups.calls).toEqual([]);
    expect(env.logger.debug).toHaveBeenCalledWith(
      '[TabCreated] No tabs found for group 1 to create native group',
    );
  });

  it('does not group the Panorama view tab', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2, VIEW), group: -1 },
      { tab: tab(3), group: undefined },
    ]);

    await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([1]);
  });

  it('does not group the only tab of a window, which might close it', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2, VIEW), group: -1 },
    ]);

    const outcome = await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabActivated',
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(env.nativeGroups.calls).toEqual([]);
    expect(env.logger.debug).toHaveBeenCalledWith(
      '[TabActivated] Skipping native group creation: Would group only tab in window (window closure risk)',
    );
  });

  it('does not group in a window that is gone', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
    ]);
    env.windows.close(WINDOW);

    const outcome = await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(env.nativeGroups.calls).toEqual([]);
    expect(env.logger.warn).toHaveBeenCalledWith(
      '[TabCreated] Window 3 was closed before creating native group',
    );
  });

  it('does not keep a group that was made in another window', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
    ]);
    env.nativeGroups.moveNextGroupToWindow(9);

    const outcome = await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(
      (await env.groupState.getGroups(WINDOW))?.[0]?.nativeGroupId,
    ).toBeUndefined();
    expect(env.logger.error).toHaveBeenCalledWith(
      '[TabCreated] ❌ Window mismatch: created group 1000 in window 9, expected 3',
    );
  });

  it('takes the tabs out of a group that was made in another window', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
    ]);
    env.nativeGroups.moveNextGroupToWindow(9);

    await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([]);
    expect(env.nativeGroups.calls).toContain('remove 1,2');
  });

  it('says so when the tabs of a group made in another window cannot be taken out', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
    ]);
    env.nativeGroups.moveNextGroupToWindow(9);
    const failure = new Error('cannot ungroup');
    const service = createNativeGroupAssignment({
      tabs: env.tabs,
      windows: env.windows,
      groupState: env.groupState,
      nativeGroups: {
        createFromTabs: (ids) => env.nativeGroups.createFromTabs(ids),
        setAppearance: (id, look) => env.nativeGroups.setAppearance(id, look),
        get: (id) => env.nativeGroups.get(id),
        removeTabs: () => Promise.reject(failure),
      },
      viewUrl: VIEW,
      logger: env.logger,
    });

    const outcome = await service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(env.logger.error).toHaveBeenCalledWith(
      '[TabCreated] Failed to ungroup tabs:',
      failure,
    );
  });

  it('does not take tabs out of a group that was made in the right window', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
    ]);

    await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(
      env.nativeGroups.calls.some((call) => call.startsWith('remove')),
    ).toBe(false);
  });

  it('does not keep a group that cannot be checked', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
    ]);
    const failure = new Error('gone');
    const service = createNativeGroupAssignment({
      tabs: env.tabs,
      windows: env.windows,
      groupState: env.groupState,
      nativeGroups: {
        createFromTabs: (ids) => env.nativeGroups.createFromTabs(ids),
        setAppearance: (id, look) => env.nativeGroups.setAppearance(id, look),
        get: () => Promise.reject(failure),
        removeTabs: (ids) => env.nativeGroups.removeTabs(ids),
      },
      viewUrl: VIEW,
      logger: env.logger,
    });

    const outcome = await service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabActivated',
    });

    expect(outcome).toEqual({ kind: 'aborted' });
    expect(
      (await env.groupState.getGroups(WINDOW))?.[0]?.nativeGroupId,
    ).toBeUndefined();
    expect(env.logger.error).toHaveBeenCalledWith(
      '[TabActivated] Failed to validate native group:',
      failure,
    );
  });

  it('passes on a failure to make the group', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
    ]);
    const failure = new Error('refused');
    const service = createNativeGroupAssignment({
      tabs: env.tabs,
      windows: env.windows,
      groupState: env.groupState,
      nativeGroups: {
        createFromTabs: () => Promise.reject(failure),
        setAppearance: (id, look) => env.nativeGroups.setAppearance(id, look),
        get: (id) => env.nativeGroups.get(id),
        removeTabs: (ids) => env.nativeGroups.removeTabs(ids),
      },
      viewUrl: VIEW,
      logger: env.logger,
    });

    await expect(
      service.createNativeGroup({
        windowId: WINDOW,
        group: group(1),
        groups: env.groups,
        label: 'TabCreated',
      }),
    ).rejects.toBe(failure);
  });

  it('reads the tabs of the window it was asked about', async () => {
    const env = await setUp([
      { tab: tab(1), group: 1 },
      { tab: tab(2), group: 1 },
      { tab: { ...tab(3), windowId: 8 }, group: 1 },
    ]);

    await env.service.createNativeGroup({
      windowId: WINDOW,
      group: group(1),
      groups: env.groups,
      label: 'TabCreated',
    });

    expect(await env.nativeGroups.tabIdsIn(1000)).toEqual([1, 2]);
  });
});
