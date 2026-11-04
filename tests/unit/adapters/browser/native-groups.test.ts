import { describe, expect, it, vi } from 'vitest';
import { createBrowserNativeGroups } from '../../../../src/js/adapters/browser/native-groups.js';
import { createBrowserToolbar } from '../../../../src/js/adapters/browser/toolbar.js';
import {
  NATIVE_GROUP_EDIT_RETRY_MS,
  NATIVE_GROUP_EDIT_TRIES,
} from '../../../../src/js/core/constants.js';

function fakeApi() {
  return {
    tabGroups: {
      update: vi.fn().mockResolvedValue({}),
      query: vi.fn().mockResolvedValue([{ id: 5 }, { id: 6 }]),
      get: vi
        .fn()
        .mockResolvedValue({ windowId: 9, title: 'Work', color: 'blue' }),
    },
    tabs: {
      query: vi.fn().mockResolvedValue([{ id: 1 }, {}, { id: 2 }]),
      // A tab is not pinned unless it is told to be
      get: vi.fn((id: number) => Promise.resolve({ pinned: id >= 100 })),
      group: vi.fn().mockResolvedValue(77),
      ungroup: vi.fn().mockResolvedValue(undefined),
    },
  };
}

describe('adapters/browser/native-groups.ts', () => {
  it('collapses and expands a native group', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);

    await groups.setCollapsed(101, true);
    await groups.setCollapsed(102, false);

    expect(api.tabGroups.update.mock.calls).toEqual([
      [101, { collapsed: true }],
      [102, { collapsed: false }],
    ]);
  });

  it('passes on a failure', async () => {
    const failure = new Error('No group with id: 7');
    const api = fakeApi();
    api.tabGroups.update.mockRejectedValue(failure);
    const groups = createBrowserNativeGroups(() => api);

    await expect(groups.setCollapsed(7, true)).rejects.toBe(failure);
  });

  it('uses the browser that exists when it is called', async () => {
    const first = fakeApi();
    const second = fakeApi();
    let current = first;
    const groups = createBrowserNativeGroups(() => current);
    current = second;

    await groups.setCollapsed(1, true);

    expect(first.tabGroups.update).not.toHaveBeenCalled();
    expect(second.tabGroups.update).toHaveBeenCalledTimes(1);
  });

  it('lists the ids of the groups in a window', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);

    expect(await groups.listIdsInWindow(4)).toEqual([5, 6]);
    expect(api.tabGroups.query).toHaveBeenCalledWith({ windowId: 4 });
  });

  it('lists the ids of the tabs in a group, leaving out tabs without one', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);

    expect(await groups.tabIdsIn(5)).toEqual([1, 2]);
    expect(api.tabs.query).toHaveBeenCalledWith({ groupId: 5 });
  });

  it('creates a group from tabs and gives back its id', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);
    expect(await groups.createFromTabs([3, 4], 9)).toBe(77);
    // The window is said: left out, the browser makes the group in the window that has the focus and moves the tabs there
    expect(api.tabs.group).toHaveBeenCalledWith({
      tabIds: [3, 4],
      createProperties: { windowId: 9 },
    });
    expect(api.tabs.group.mock.calls[0]?.[0]).not.toHaveProperty('groupId');
  });

  it('adds tabs to an existing group', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);

    await groups.addTabs([3], 5);

    expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [3], groupId: 5 });
  });

  describe('pinned tabs, which grouping would unpin', () => {
    it('leaves them out of a new group', async () => {
      const api = fakeApi();
      const groups = createBrowserNativeGroups(() => api);

      await groups.createFromTabs([3, 100, 4, 101], 9);

      expect(api.tabs.group).toHaveBeenCalledWith({
        tabIds: [3, 4],
        createProperties: { windowId: 9 },
      });
    });

    it('leaves them out of a group that exists', async () => {
      const api = fakeApi();
      const groups = createBrowserNativeGroups(() => api);

      await groups.addTabs([3, 100], 5);

      expect(api.tabs.group).toHaveBeenCalledWith({ tabIds: [3], groupId: 5 });
    });

    it('makes no group of tabs that are all pinned, and says so', async () => {
      const api = fakeApi();
      const groups = createBrowserNativeGroups(() => api);

      await expect(groups.createFromTabs([100, 101], 9)).rejects.toThrow(
        'Every tab is pinned, so there is nothing to group',
      );
      expect(api.tabs.group).not.toHaveBeenCalled();
    });

    it('adds nothing to a group of tabs that are all pinned', async () => {
      const api = fakeApi();
      const groups = createBrowserNativeGroups(() => api);

      await expect(groups.addTabs([100], 5)).resolves.toBeUndefined();
      expect(api.tabs.group).not.toHaveBeenCalled();
    });

    it('fails for a tab that is gone, as grouping it would', async () => {
      const api = fakeApi();
      const failure = new Error('Invalid tab ID: 3');
      api.tabs.get.mockRejectedValue(failure);
      const groups = createBrowserNativeGroups(() => api);

      await expect(groups.addTabs([3], 5)).rejects.toBe(failure);
      await expect(groups.createFromTabs([3], 9)).rejects.toBe(failure);
    });
  });

  it('takes tabs out of their native group', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);
    const tabIds = [3, 4];

    await groups.removeTabs(tabIds);

    expect(api.tabs.ungroup).toHaveBeenCalledWith([3, 4]);
    expect(api.tabs.ungroup.mock.calls[0]?.[0]).not.toBe(tabIds);
  });

  it('sets the title and colour of a group', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);

    await groups.setAppearance(5, { title: 'Work', color: 'blue' });

    expect(api.tabGroups.update).toHaveBeenCalledWith(5, {
      title: 'Work',
      color: 'blue',
    });
  });

  it('gives a group a new title, and nothing else', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);

    await groups.setTitle(5, 'Renamed');

    expect(api.tabGroups.update).toHaveBeenCalledTimes(1);
    expect(api.tabGroups.update.mock.calls[0]).toStrictEqual([
      5,
      { title: 'Renamed' },
    ]);
  });

  it('asks for the title again while the browser refuses it as a tab is dragged, then sets it', async () => {
    const api = fakeApi();
    const dragging = new Error(
      'Tabs cannot be edited right now (user may be dragging a tab).',
    );
    api.tabGroups.update
      .mockRejectedValueOnce(dragging)
      .mockRejectedValueOnce(dragging)
      .mockResolvedValue(undefined);
    const wait = vi.fn().mockResolvedValue(undefined);
    const groups = createBrowserNativeGroups(() => api, wait);

    await groups.setTitle(5, 'Renamed');

    expect(api.tabGroups.update).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(NATIVE_GROUP_EDIT_RETRY_MS);
  });

  it('passes on a refusal for anything else at once', async () => {
    const api = fakeApi();
    const failure = new Error('No group with id: 5.');
    api.tabGroups.update.mockRejectedValue(failure);
    const wait = vi.fn().mockResolvedValue(undefined);
    const groups = createBrowserNativeGroups(() => api, wait);

    await expect(groups.setTitle(5, 'Renamed')).rejects.toBe(failure);

    expect(api.tabGroups.update).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
  });

  it('gives up, and passes the refusal on, when the drag lasts', async () => {
    const api = fakeApi();
    const dragging = new Error(
      'Tabs cannot be edited right now (user may be dragging a tab).',
    );
    api.tabGroups.update.mockRejectedValue(dragging);
    const wait = vi.fn().mockResolvedValue(undefined);
    const groups = createBrowserNativeGroups(() => api, wait);

    await expect(groups.setTitle(5, 'Renamed')).rejects.toBe(dragging);

    expect(api.tabGroups.update).toHaveBeenCalledTimes(NATIVE_GROUP_EDIT_TRIES);
    expect(wait).toHaveBeenCalledTimes(NATIVE_GROUP_EDIT_TRIES - 1);
  });

  it('waits a real while between tries where it is not told how', async () => {
    vi.useFakeTimers();
    try {
      const api = fakeApi();
      api.tabGroups.update
        .mockRejectedValueOnce(
          new Error(
            'Tabs cannot be edited right now (user may be dragging a tab).',
          ),
        )
        .mockResolvedValue(undefined);
      const groups = createBrowserNativeGroups(() => api);

      const titled = groups.setTitle(5, 'Renamed');
      await vi.advanceTimersByTimeAsync(NATIVE_GROUP_EDIT_RETRY_MS - 1);
      expect(api.tabGroups.update).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await titled;

      expect(api.tabGroups.update).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sets only the title when there is no colour', async () => {
    const api = fakeApi();
    const groups = createBrowserNativeGroups(() => api);

    await groups.setAppearance(5, { title: 'Work', color: undefined });

    expect(api.tabGroups.update.mock.calls[0]?.[1]).toStrictEqual({
      title: 'Work',
    });
  });

  it('gives the window, title and whether it is collapsed of a group, and nothing else about it', async () => {
    const api = fakeApi();
    api.tabGroups.get.mockResolvedValue({
      windowId: 9,
      title: 'Work',
      color: 'blue',
      collapsed: true,
    });
    const groups = createBrowserNativeGroups(() => api);

    expect(await groups.get(5)).toStrictEqual({
      windowId: 9,
      title: 'Work',
      collapsed: true,
    });
    expect(api.tabGroups.get).toHaveBeenCalledWith(5);
  });

  it('says a group is not collapsed when the browser does not say', async () => {
    const groups = createBrowserNativeGroups(() => fakeApi());

    expect(await groups.get(5)).toMatchObject({ collapsed: false });
  });

  it('passes on a failure to find a group', async () => {
    const failure = new Error('gone');
    const api = fakeApi();
    api.tabGroups.get.mockRejectedValue(failure);
    const groups = createBrowserNativeGroups(() => api);

    await expect(groups.get(5)).rejects.toBe(failure);
  });
});

describe('adapters/browser/toolbar.ts', () => {
  const api = () => ({
    setTitle: vi.fn().mockResolvedValue(undefined),
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    setPopup: vi.fn().mockResolvedValue(undefined),
  });

  it('sets the title for a window', async () => {
    const action = api();
    const toolbar = createBrowserToolbar(() => ({ action }));

    await toolbar.setTitle(3, 'Active Group: Work');

    expect(action.setTitle).toHaveBeenCalledTimes(1);
    expect(action.setTitle).toHaveBeenCalledWith({
      title: 'Active Group: Work',
      windowId: 3,
    });
  });

  it('sets the badge text for a window', async () => {
    const action = api();
    const toolbar = createBrowserToolbar(() => ({ action }));

    await toolbar.setBadgeText(3, '2');

    expect(action.setBadgeText).toHaveBeenCalledWith({
      text: '2',
      windowId: 3,
    });
  });

  it('sets the badge text for the windows that have none of their own', async () => {
    const action = api();
    const toolbar = createBrowserToolbar(() => ({ action }));

    await toolbar.setDefaultBadgeText('...');

    expect(action.setBadgeText).toHaveBeenCalledTimes(1);
    expect(action.setBadgeText.mock.calls[0]?.[0]).toStrictEqual({
      text: '...',
    });
  });

  it('sets the page the button opens', async () => {
    const action = api();
    const toolbar = createBrowserToolbar(() => ({ action }));

    await toolbar.setPopup('popup-view/index.html');

    expect(action.setPopup).toHaveBeenCalledWith({
      popup: 'popup-view/index.html',
    });
  });

  it('sets the badge colour', async () => {
    const action = api();
    const toolbar = createBrowserToolbar(() => ({ action }));

    await toolbar.setBadgeBackgroundColor('#666666');

    expect(action.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: '#666666',
    });
  });

  it('passes on a failure', async () => {
    const failure = new Error('no such window');
    const toolbar = createBrowserToolbar(() => ({
      action: {
        setTitle: vi.fn().mockRejectedValue(failure),
        setBadgeText: vi.fn().mockRejectedValue(failure),
        setBadgeBackgroundColor: vi.fn().mockRejectedValue(failure),
        setPopup: vi.fn().mockRejectedValue(failure),
      },
    }));

    await expect(toolbar.setPopup('p')).rejects.toBe(failure);
    await expect(toolbar.setDefaultBadgeText('t')).rejects.toBe(failure);
    await expect(toolbar.setTitle(1, 't')).rejects.toBe(failure);
    await expect(toolbar.setBadgeText(1, 't')).rejects.toBe(failure);
    await expect(toolbar.setBadgeBackgroundColor('c')).rejects.toBe(failure);
  });

  it('uses the browser that exists when it is called', async () => {
    const first = api();
    const second = api();
    let current = first;
    const toolbar = createBrowserToolbar(() => ({ action: current }));
    current = second;

    await toolbar.setTitle(1, 't');

    expect(first.setTitle).not.toHaveBeenCalled();
    expect(second.setTitle).toHaveBeenCalledTimes(1);
  });
});
