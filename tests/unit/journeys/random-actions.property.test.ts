import fc from 'fast-check';
import { describe, it } from 'vitest';
import { arrangeGroups } from '../../support/world/scenarios.js';
import { type World, createWorld } from '../../support/world/world.js';

// What a person does with the browser and the add-on, in any order, and what must hold after each thing:
// the invariants of the data (docs/plans/data-structures-review.md) over the whole add-on, in the model
// of the browser of tests/support/world. A failure comes with the shortest run of actions that causes it.

type Action =
  | { kind: 'openTab'; window: number; active: boolean }
  | { kind: 'closeTab'; tab: number }
  | { kind: 'openWindow'; tabs: number }
  | { kind: 'closeWindow'; window: number }
  | { kind: 'restoreWindow' }
  | { kind: 'moveTab'; tab: number; window: number }
  | { kind: 'activateTab'; tab: number }
  | { kind: 'sendTabToGroup'; tab: number; group: number }
  | { kind: 'ungroupNative'; group: number }
  | { kind: 'setNative'; on: boolean }
  | { kind: 'deleteGroup'; window: number; group: number }
  | { kind: 'focusWindow'; window: number }
  | { kind: 'restart' };

const index = fc.nat({ max: 20 });

const action: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant<'openTab'>('openTab'),
    window: index,
    active: fc.boolean(),
  }),
  fc.record({ kind: fc.constant<'closeTab'>('closeTab'), tab: index }),
  fc.record({
    kind: fc.constant<'openWindow'>('openWindow'),
    tabs: fc.integer({ min: 1, max: 3 }),
  }),
  fc.record({ kind: fc.constant<'closeWindow'>('closeWindow'), window: index }),
  fc.constant<Action>({ kind: 'restoreWindow' }),
  fc.record({
    kind: fc.constant<'moveTab'>('moveTab'),
    tab: index,
    window: index,
  }),
  fc.record({ kind: fc.constant<'activateTab'>('activateTab'), tab: index }),
  fc.record({
    kind: fc.constant<'sendTabToGroup'>('sendTabToGroup'),
    tab: index,
    group: index,
  }),
  fc.record({
    kind: fc.constant<'ungroupNative'>('ungroupNative'),
    group: index,
  }),
  fc.record({ kind: fc.constant<'setNative'>('setNative'), on: fc.boolean() }),
  fc.record({
    kind: fc.constant<'deleteGroup'>('deleteGroup'),
    window: index,
    group: index,
  }),
  fc.record({ kind: fc.constant<'focusWindow'>('focusWindow'), window: index }),
  fc.constant<Action>({ kind: 'restart' }),
);

/** The place of a list that a number picks, wrapping round; nothing for an empty list */
const pick = <T>(list: readonly T[], at: number): T | undefined =>
  list.length === 0 ? undefined : list[at % list.length];

const RESERVED = new Set([-1, -2]);

/** What a person has in front of them: windows and their tabs, as the browser has them */
const windowsOf = (world: World) => [...world.model.windows.values()];
const tabsOf = (world: World) => [...world.model.tabs.values()];

/** Do the action if it can be done by a person without ending the browser; what was done, or nothing */
async function perform(
  world: World,
  step: Action,
): Promise<string | undefined> {
  const windows = windowsOf(world);
  const tabs = tabsOf(world);
  const tab = pick(tabs, 'tab' in step ? step.tab : 0);
  const window = pick(windows, 'window' in step ? step.window : 0);

  switch (step.kind) {
    case 'openTab': {
      if (window === undefined) {
        return undefined;
      }
      const opened = await world.openTab(
        window.id,
        'https://example.test/',
        step.active,
      );
      return `openTab ${String(opened)} in w${String(window.id)}${step.active ? ' (in front)' : ''}`;
    }
    case 'closeTab':
      // Closing the last tab of the last window ends the browser
      if (tab === undefined || tabs.length < 2) {
        return undefined;
      }
      await world.closeTab(tab.id);
      return `closeTab ${String(tab.id)}`;
    case 'openWindow':
      await world.openWindow(
        Array.from({ length: step.tabs }, (_, at) => `https://w${String(at)}/`),
      );
      return `openWindow with ${String(step.tabs)} tabs`;
    case 'closeWindow':
      if (window === undefined || windows.length < 2) {
        return undefined;
      }
      await world.closeWindow(window.id);
      return `closeWindow ${String(window.id)}`;
    case 'restoreWindow':
      return (await world.restoreWindow()) === undefined
        ? undefined
        : 'restoreWindow';
    case 'moveTab':
      if (tab === undefined || window === undefined) {
        return undefined;
      }
      await world.moveTab(tab.id, window.id);
      return `moveTab ${String(tab.id)} to w${String(window.id)}`;
    case 'activateTab':
      if (tab === undefined) {
        return undefined;
      }
      await world.activateTab(tab.id);
      return `activateTab ${String(tab.id)} (w${String(tab.windowId)}, focus in w${String(world.model.focused())})`;
    case 'sendTabToGroup': {
      if (tab === undefined) {
        return undefined;
      }
      const groups = (await world.groupsOf(tab.windowId)).filter(
        ({ id: groupId }) => !RESERVED.has(groupId) && groupId >= 0,
      );
      const group = pick(groups, step.group);
      if (group === undefined) {
        return undefined;
      }
      await world.sendTabToGroup(tab.id, group.id);
      return `sendTabToGroup ${String(tab.id)} (w${String(tab.windowId)}) to group ${String(group.id)}`;
    }
    case 'ungroupNative': {
      const native = pick([...world.model.groups.keys()], step.group);
      if (native === undefined) {
        return undefined;
      }
      await world.ungroupGroup(native);
      return `ungroupNative ${String(native)}`;
    }
    case 'setNative':
      await world.setNativeGroups(step.on);
      return `setNative ${String(step.on)}`;
    case 'deleteGroup': {
      if (window === undefined) {
        return undefined;
      }
      const groups = (await world.groupsOf(window.id)).filter(
        ({ id: groupId }) => groupId >= 0,
      );
      const group = pick(groups, step.group);
      if (group === undefined) {
        return undefined;
      }
      // The view is a tab of the window, and stays: a group that has all the tabs of a window is not
      // deleted from a window that would be left with none, which the browser would close
      const inGroup = (
        await Promise.all(
          world.model.tabsOf(window.id).map(async ({ id: tabId }) => ({
            group: await world.groupState.getTabGroup(tabId),
          })),
        )
      ).filter((each) => each.group === group.id);
      if (inGroup.length >= world.model.tabsOf(window.id).length) {
        return undefined;
      }
      await world.deleteGroup(window.id, group.id);
      return `deleteGroup ${String(group.id)} of w${String(window.id)}`;
    }
    case 'focusWindow':
      if (window === undefined) {
        return undefined;
      }
      await world.focusWindow(window.id);
      return `focusWindow ${String(window.id)}`;
    case 'restart':
      await world.restart();
      return 'restart';
    default:
      return undefined;
  }
}

/** What must be true of the data after anything a person does; the first thing that is not, or nothing */
async function violation(world: World): Promise<string | undefined> {
  const problems: string[] = [];
  const nativeGroups = world.model.groups;

  await Promise.all(
    windowsOf(world).map(async (window) => {
      const groups = await world.groupsOf(window.id);
      const ids = groups.map(({ id: groupId }) => groupId);

      if (new Set(ids).size !== ids.length) {
        problems.push(
          `window ${String(window.id)} has two groups with one id: ${ids.join()}`,
        );
      }

      const active = await world.groupState.getActiveGroup(window.id);
      if (active !== undefined && !ids.includes(active)) {
        problems.push(
          `window ${String(window.id)}: the active group ${String(active)} does not exist (${ids.join()})`,
        );
      }

      groups.forEach((group) => {
        const reference = group.nativeGroupId;
        if (typeof reference === 'number' && reference > 0) {
          const native = nativeGroups.get(reference);
          if (native === undefined) {
            problems.push(
              `window ${String(window.id)}: group ${String(group.id)} refers to the native group ${String(reference)}, which is gone`,
            );
          } else if (native.windowId !== window.id) {
            problems.push(
              `window ${String(window.id)}: group ${String(group.id)} refers to a native group of window ${String(native.windowId)}`,
            );
          }
        }
      });

      await Promise.all(
        world.model.tabsOf(window.id).map(async (tab) => {
          const group = await world.groupState.getTabGroup(tab.id);
          if (group === undefined) {
            problems.push(
              `tab ${String(tab.id)} of window ${String(window.id)} is in no group`,
            );
          } else if (!ids.includes(group) && !RESERVED.has(group)) {
            problems.push(
              `tab ${String(tab.id)} of window ${String(window.id)} is in group ${String(group)}, which the window does not have (${ids.join()})`,
            );
          }
        }),
      );
    }),
  );

  if (!(await world.options.load()).useNativeGroups && nativeGroups.size > 0) {
    problems.push(
      `native groups are off, and the browser has ${String(nativeGroups.size)}`,
    );
  }
  if (world.logs.error.length > 0) {
    problems.push(`the add-on logged: ${world.logs.error.join(' | ')}`);
  }
  return problems[0];
}

describe('any run of what a person does', () => {
  it('leaves the data of the add-on whole after each step', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.boolean(),
        fc.integer({ min: 1, max: 2 }),
        fc.array(action, { maxLength: 18 }),
        async (native, windowCount, actions) => {
          const world = createWorld({ stored: { useNativeGroups: native } });
          Array.from({ length: windowCount }, (_, at) => at).forEach((at) => {
            world.seedWindow(
              Array.from(
                { length: 3 },
                (__, tab) => `https://s${String(at)}${String(tab)}/`,
              ),
            );
          });
          await Promise.all(
            windowsOf(world).map((window) =>
              arrangeGroups(
                world,
                window.id,
                window.tabIds,
                window.tabIds.map((_, place) => 1 + (place % 2)),
                1,
              ),
            ),
          );
          await world.start();

          const done: string[] = [];
          const failure = await actions.reduce<Promise<string | undefined>>(
            async (previous, step) => {
              const earlier = await previous;
              if (earlier !== undefined) {
                return earlier;
              }
              const did = await perform(world, step);
              if (did !== undefined) {
                done.push(did);
              }
              const broken = await violation(world);
              return broken === undefined
                ? undefined
                : `${broken}\n  after:\n    ${done.join('\n    ')}`;
            },
            violation(world),
          );

          if (failure !== undefined) {
            throw new Error(failure);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});
