import { describe, expect, it } from 'vitest';
import { createMemoryNativeGroups } from '../../../../src/js/adapters/memory/native-groups.js';
import { createMemoryTabs } from '../../../../src/js/adapters/memory/tabs.js';
import { createMemoryToolbar } from '../../../../src/js/adapters/memory/toolbar.js';

describe('adapters/memory/native-groups.ts', () => {
  it('starts with the groups it was told about, all expanded', () => {
    const groups = createMemoryNativeGroups([3, 4]);

    expect([...groups.collapsed]).toEqual([
      [3, false],
      [4, false],
    ]);
  });

  it('collapses and expands a group and remembers what was done', async () => {
    const groups = createMemoryNativeGroups([3]);

    await groups.setCollapsed(3, true);
    expect(groups.collapsed.get(3)).toBe(true);
    await groups.setCollapsed(3, false);
    expect(groups.collapsed.get(3)).toBe(false);

    expect(groups.calls).toEqual(['collapse 3', 'expand 3']);
  });

  it('fails for a group that does not exist, and still notes the attempt', async () => {
    const groups = createMemoryNativeGroups([3]);

    await expect(groups.setCollapsed(9, true)).rejects.toThrow(
      'No group with id: 9',
    );

    expect(groups.collapsed.has(9)).toBe(false);
    expect(groups.calls).toEqual(['collapse 9']);
  });

  it('has no groups when given none', () => {
    expect(createMemoryNativeGroups().collapsed.size).toBe(0);
  });
});

describe('adapters/memory/native-groups.ts (membership)', () => {
  it('lists the groups of a window, and only that window', async () => {
    const groups = createMemoryNativeGroups([1], 7);
    groups.seed(2, 8);

    expect(await groups.listIdsInWindow(7)).toEqual([1]);
    expect(await groups.listIdsInWindow(8)).toEqual([2]);
    expect(await groups.listIdsInWindow(9)).toEqual([]);
  });

  it('has the tabs a group was seeded with, and none for an unknown group', async () => {
    const groups = createMemoryNativeGroups();
    groups.seed(2, 8, [4, 5]);

    expect(await groups.tabIdsIn(2)).toEqual([4, 5]);
    expect(await groups.tabIdsIn(3)).toEqual([]);
    expect(groups.collapsed.get(2)).toBe(false);
  });

  it('does not let a caller change the seeded tabs', async () => {
    const groups = createMemoryNativeGroups();
    const tabs = [4];
    groups.seed(2, 8, tabs);
    tabs.push(5);

    expect(await groups.tabIdsIn(2)).toEqual([4]);
  });

  it('creates groups with counting ids in the window it is asked for', async () => {
    const groups = createMemoryNativeGroups([], 7);

    const first = await groups.createFromTabs([1, 2], 7);
    const second = await groups.createFromTabs([3], 7);

    expect(second).toBe(first + 1);
    expect(await groups.tabIdsIn(first)).toEqual([1, 2]);
    expect((await groups.get(first)).windowId).toBe(7);
    expect(groups.collapsed.get(first)).toBe(false);
    expect(groups.calls).toEqual(['create 1,2', 'create 3']);
  });

  it('moves tabs out of the group they were in when they join another', async () => {
    const groups = createMemoryNativeGroups();
    groups.seed(1, 7, [1, 2]);

    const created = await groups.createFromTabs([2], 7);

    expect(await groups.tabIdsIn(1)).toEqual([1]);
    expect(await groups.tabIdsIn(created)).toEqual([2]);
  });

  it('can create a group in a different window, just the once', async () => {
    const groups = createMemoryNativeGroups([], 7);
    groups.moveNextGroupToWindow(8);

    const odd = await groups.createFromTabs([1], 7);
    const normal = await groups.createFromTabs([2], 7);

    expect((await groups.get(odd)).windowId).toBe(8);
    expect((await groups.get(normal)).windowId).toBe(7);
  });

  it('adds tabs to a group and takes them out of their old one', async () => {
    const groups = createMemoryNativeGroups();
    groups.seed(1, 7, [1, 3]);
    groups.seed(2, 7, [2]);

    await groups.addTabs([1, 3], 2);

    expect(await groups.tabIdsIn(1)).toEqual([]);
    expect(await groups.tabIdsIn(2)).toEqual([2, 1, 3]);
    expect(groups.calls).toEqual(['add 1,3 to 2']);
  });

  it('fails to add tabs to a group that does not exist', async () => {
    const groups = createMemoryNativeGroups();

    await expect(groups.addTabs([1], 5)).rejects.toThrow(
      new Error('No group with id: 5'),
    );
  });

  it('takes tabs out of their groups', async () => {
    const groups = createMemoryNativeGroups();
    groups.seed(1, 7, [1, 2, 3]);

    await groups.removeTabs([1, 3]);

    expect(await groups.tabIdsIn(1)).toEqual([2]);
    expect(groups.calls).toEqual(['remove 1,3']);
  });

  it('remembers the title and colour of a group', async () => {
    const groups = createMemoryNativeGroups([1]);

    await groups.setAppearance(1, { title: 'Work', color: 'blue' });

    expect(groups.groups.get(1)).toEqual({
      windowId: 1,
      tabIds: [],
      title: 'Work',
      color: 'blue',
    });
    expect(groups.calls).toEqual(['appearance 1 Work']);
  });

  it('fails to style a group that does not exist', async () => {
    const groups = createMemoryNativeGroups();

    await expect(
      groups.setAppearance(5, { title: 'x', color: undefined }),
    ).rejects.toThrow(new Error('No group with id: 5'));
  });

  it('gives the window and title of a group, and fails for one that does not exist', async () => {
    const groups = createMemoryNativeGroups([1], 7);
    await groups.setAppearance(1, { title: 'Work', color: undefined });

    expect(await groups.get(1)).toEqual({ windowId: 7, title: 'Work' });
    await expect(groups.get(2)).rejects.toThrow(
      new Error('No group with id: 2'),
    );
  });
});

describe('adapters/memory/tabs.ts (details)', () => {
  const tab = (id: number, windowId: number) => ({
    id,
    windowId,
    active: false,
    pinned: false,
    url: undefined,
    pendingUrl: undefined,
    title: undefined,
    browserGroupId: undefined,
  });

  it('gives a copy of a tab by id', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7), tab(2, 8)]);

    const found = await tabs.get(2);
    found.active = true;

    expect(found).toEqual({ ...tab(2, 8), active: true });
    expect(await tabs.get(2)).toEqual(tab(2, 8));
  });

  it('fails to give a tab that does not exist', async () => {
    const tabs = createMemoryTabs();

    await expect(tabs.get(4)).rejects.toThrow(new Error('Invalid tab ID: 4'));
  });

  it('lists copies of the tabs in a window', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7), tab(2, 8), tab(3, 7)]);

    const listed = await tabs.listInWindow(7);
    listed.forEach((each) => {
      each.active = true;
    });

    expect(listed.map(({ id }) => id)).toEqual([1, 3]);
    expect(await tabs.listInWindow(7)).toEqual([tab(1, 7), tab(3, 7)]);
  });

  it('does not let a caller change the tabs it was given', async () => {
    const tabs = createMemoryTabs();
    const given = [tab(1, 7)];
    tabs.setDetails(given);
    given[0] = { ...tab(1, 7), active: true };

    expect(await tabs.get(1)).toEqual(tab(1, 7));
  });
});

describe('adapters/memory/tabs.ts (actions)', () => {
  const tab = (id: number, windowId: number, active = false) => ({
    id,
    windowId,
    active,
    pinned: false,
    url: undefined,
    pendingUrl: undefined,
    title: undefined,
    browserGroupId: undefined,
  });

  it('lists the selected tabs of a window: the active one and those marked', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7, true), tab(2, 7), tab(3, 7), tab(4, 8, true)]);
    tabs.setHighlighted([3, 4]);

    expect(await tabs.highlightedIdsInWindow(7)).toEqual([1, 3]);
    expect(await tabs.highlightedIdsInWindow(8)).toEqual([4]);
  });

  it('forgets the tabs it was told were selected when told again', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7), tab(2, 7)]);
    tabs.setHighlighted([1]);
    tabs.setHighlighted([2]);

    expect(await tabs.highlightedIdsInWindow(7)).toEqual([2]);
  });

  it('lists the tabs of a window that are not hidden, in order', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7), tab(2, 7), tab(3, 8), tab(4, 7)]);
    await tabs.hide([2]);

    expect(await tabs.visibleIdsInWindow(7)).toEqual([1, 4]);
    await tabs.show([2]);
    expect(await tabs.visibleIdsInWindow(7)).toEqual([1, 2, 4]);
  });

  it('moves a tab after all the others', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7), tab(2, 7), tab(3, 7)]);

    await tabs.moveToEnd(1);

    expect((await tabs.listInWindow(7)).map(({ id }) => id)).toEqual([2, 3, 1]);
    expect(tabs.calls).toEqual(['move 1']);
  });

  it('closes a tab, and fails for one that is not there', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7), tab(2, 7)]);

    await tabs.close(1);
    await expect(tabs.close(1)).rejects.toThrow(new Error('Invalid tab ID: 1'));

    expect((await tabs.listInWindow(7)).map(({ id }) => id)).toEqual([2]);
    expect(tabs.calls).toEqual(['close 1', 'close 1']);
  });

  it('opens pages in new tabs with counting ids in the window set for it', async () => {
    const tabs = createMemoryTabs();
    tabs.openWindowId = 7;

    const first = await tabs.open('/view.html', true);
    const second = await tabs.open('https://x/', false);

    expect(second).toBe(first + 1);
    expect(await tabs.listInWindow(7)).toEqual([
      { ...tab(first, 7, true), url: '/view.html' },
      { ...tab(second, 7, false), url: 'https://x/' },
    ]);
    expect(tabs.calls).toEqual(['open /view.html', 'open https://x/']);
  });

  it('opens pages in window 1 unless told otherwise', async () => {
    const tabs = createMemoryTabs();

    const id = await tabs.open('/a', true);

    expect((await tabs.get(id)).windowId).toBe(1);
  });
});

describe('adapters/memory/tabs.ts (backup)', () => {
  const tab = (id: number, windowId: number, pinned = false) => ({
    id,
    windowId,
    active: false,
    pinned,
    url: `https://site${String(id)}/`,
    pendingUrl: undefined,
    title: `T${String(id)}`,
    browserGroupId: undefined,
  });

  it('gives snapshots of the tabs of a window in order, with the time each was used', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7), tab(2, 8), tab(3, 7, true)]);
    tabs.setLastAccessed({ 3: 500 });

    expect(await tabs.snapshotsInWindow(7)).toEqual([
      {
        id: 1,
        url: 'https://site1/',
        title: 'T1',
        index: 0,
        lastAccessed: 0,
        pinned: false,
      },
      {
        id: 3,
        url: 'https://site3/',
        title: 'T3',
        index: 1,
        lastAccessed: 500,
        pinned: true,
      },
    ]);
  });

  it('forgets the times it was told when told again', async () => {
    const tabs = createMemoryTabs();
    tabs.setDetails([tab(1, 7)]);
    tabs.setLastAccessed({ 1: 5 });
    tabs.setLastAccessed({});

    expect((await tabs.snapshotsInWindow(7))[0]?.lastAccessed).toBe(0);
  });

  it('creates tabs with counting ids, as asked', async () => {
    const tabs = createMemoryTabs();

    const first = await tabs.create({
      url: '/a',
      windowId: 7,
      active: true,
      discarded: true,
      pinned: true,
    });
    const second = await tabs.create({
      url: '/b',
      windowId: 8,
      active: false,
      discarded: false,
      pinned: false,
    });

    expect(second).toBe(first + 1);
    expect(await tabs.get(first)).toMatchObject({
      windowId: 7,
      active: true,
      pinned: true,
      url: '/a',
    });
    expect(tabs.calls).toEqual([
      'create /a in 7 discarded pinned active',
      'create /b in 8',
    ]);
  });

  it('refuses the next creation when told to, and only that one', async () => {
    const tabs = createMemoryTabs();
    const failure = new Error('refused');
    tabs.refuseNextCreate(failure);
    const options = {
      url: '/a',
      windowId: 1,
      active: false,
      discarded: false,
      pinned: false,
    };

    await expect(tabs.create(options)).rejects.toBe(failure);
    await expect(tabs.create(options)).resolves.toBeTypeOf('number');
  });
});

describe('adapters/memory/toolbar.ts (popup and default badge)', () => {
  it('remembers the popup and the default badge text', async () => {
    const toolbar = createMemoryToolbar();

    await toolbar.setPopup('popup-view/index.html');
    await toolbar.setDefaultBadgeText('...');

    expect(toolbar.popup).toBe('popup-view/index.html');
    expect(toolbar.defaultBadgeText).toBe('...');
  });

  it('fails them too once told to', async () => {
    const toolbar = createMemoryToolbar();
    const failure = new Error('no');
    toolbar.failWith(failure);

    await expect(toolbar.setPopup('p')).rejects.toBe(failure);
    await expect(toolbar.setDefaultBadgeText('t')).rejects.toBe(failure);
    expect(toolbar.popup).toBeUndefined();
    expect(toolbar.defaultBadgeText).toBeUndefined();
  });
});

describe('adapters/memory/toolbar.ts', () => {
  it('remembers the title and badge text of each window', async () => {
    const toolbar = createMemoryToolbar();

    await toolbar.setTitle(1, 'One');
    await toolbar.setTitle(2, 'Two');
    await toolbar.setBadgeText(1, '3');

    expect([...toolbar.titles]).toEqual([
      [1, 'One'],
      [2, 'Two'],
    ]);
    expect([...toolbar.badgeTexts]).toEqual([[1, '3']]);
  });

  it('remembers the badge colour', async () => {
    const toolbar = createMemoryToolbar();
    expect(toolbar.badgeColor).toBeUndefined();

    await toolbar.setBadgeBackgroundColor('#666666');

    expect(toolbar.badgeColor).toBe('#666666');
  });

  it('fails every call once told to, and changes nothing', async () => {
    const toolbar = createMemoryToolbar();
    const failure = new Error('no such window');
    toolbar.failWith(failure);

    await expect(toolbar.setTitle(1, 'x')).rejects.toBe(failure);
    await expect(toolbar.setBadgeText(1, 'x')).rejects.toBe(failure);
    await expect(toolbar.setBadgeBackgroundColor('x')).rejects.toBe(failure);

    expect(toolbar.titles.size).toBe(0);
    expect(toolbar.badgeTexts.size).toBe(0);
    expect(toolbar.badgeColor).toBeUndefined();
  });
});
