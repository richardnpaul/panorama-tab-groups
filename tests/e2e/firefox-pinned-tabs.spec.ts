import { expect, test } from '@playwright/test';
import { type Lab, startLab } from './lab/lab.js';
import { numberFrom, worldOf } from './lab/world.js';

// What the real Firefox does with pinned tabs and native tab groups (docs/plans/data-structures-review.md,
// decision 6), asked of it by a probe extension. The fake browser of the unit tests is built on these
// facts, and these tests are how it is kept true.

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

test.describe('Pinned tabs and native groups, in Firefox', () => {
  test.skip(
    ({ browserName }) => browserName !== 'firefox',
    'Asked of the Firefox that Playwright brings',
  );

  let lab: Lab;

  test.beforeEach(async () => {
    lab = await startLab({ probes: ['a'] });
  });

  test.afterEach(async () => {
    await lab.close();
  });

  /** Two tabs in a window of their own, ready to be grouped, pinned or both */
  async function twoTabs() {
    const world = worldOf(lab, 'a');
    const { windowId, tabIds } = await world.openWindow([
      'one',
      'two',
      'three',
    ]);
    return { windowId, tabIds };
  }

  /** Whether a tab is pinned, and the native group it is in (-1 for none) */
  async function stateOf(tabId: number) {
    const tab = await lab.probe('a').call('tabs.get', tabId);
    if (!isObject(tab)) {
      throw new Error('tabs.get gave no tab');
    }
    return { pinned: tab.pinned, groupId: tab.groupId };
  }

  const update = (tabId: number, pinned: boolean) =>
    lab.probe('a').call('tabs.update', tabId, { pinned });

  test('takes a tab out of its group when it is pinned, and does not put it back when it is unpinned', async () => {
    const a = lab.probe('a');
    const { tabIds } = await twoTabs();
    const [grouped = 0, other = 0] = tabIds.slice(1);
    const group = numberFrom(
      await a.call('tabs.group', { tabIds: [grouped, other] }),
      'tabs.group',
    );
    expect(await stateOf(grouped)).toEqual({ pinned: false, groupId: group });

    await update(grouped, true);
    expect(await stateOf(grouped)).toEqual({ pinned: true, groupId: -1 });

    await update(grouped, false);
    expect(await stateOf(grouped)).toEqual({ pinned: false, groupId: -1 });
  });

  test('unpins a pinned tab that is put in a group, a new one or one that exists', async () => {
    const a = lab.probe('a');
    const { tabIds } = await twoTabs();
    const [, first = 0, second = 0] = tabIds;
    await update(first, true);
    await update(second, true);

    const group = numberFrom(
      await a.call('tabs.group', { tabIds: [first] }),
      'tabs.group',
    );
    expect(await stateOf(first)).toEqual({ pinned: false, groupId: group });

    await a.call('tabs.group', { tabIds: [second], groupId: group });
    expect(await stateOf(second)).toEqual({ pinned: false, groupId: group });
  });

  test('does not keep a pinned tab in a group by unpinning it, grouping it, and pinning it again: pinning takes it out', async () => {
    const a = lab.probe('a');
    const { tabIds } = await twoTabs();
    const [, tab = 0, other = 0] = tabIds;
    await update(tab, true);
    const group = numberFrom(
      await a.call('tabs.group', { tabIds: [other] }),
      'tabs.group',
    );

    await update(tab, false);
    await a.call('tabs.group', { tabIds: [tab], groupId: group });
    expect(await stateOf(tab)).toEqual({ pinned: false, groupId: group });
    await update(tab, true);

    expect(await stateOf(tab)).toEqual({ pinned: true, groupId: -1 });
  });

  test('shows a hidden tab when it is pinned', async () => {
    const a = lab.probe('a');
    const { tabIds } = await twoTabs();
    const [, hidden = 0] = tabIds;
    await a.call('tabs.hide', [hidden]);
    const before = await a.call('tabs.get', hidden);
    expect(isObject(before) && before.hidden).toBe(true);

    await update(hidden, true);

    const after = await a.call('tabs.get', hidden);
    expect(after).toMatchObject({ pinned: true, hidden: false });
  });
});
