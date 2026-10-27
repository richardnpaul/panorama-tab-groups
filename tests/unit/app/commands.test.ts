import { describe, expect, it, vi } from 'vitest';
import { createMemoryExtension } from '../../../src/js/adapters/memory/extension.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createCommands } from '../../../src/js/app/commands.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import type { Options } from '../../../src/js/core/options.js';

const WINDOW = 3;

const group = (id: number): Group => ({
  id,
  name: `G${String(id)}`,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

const optionsWith = (shortcut: Options['shortcut']): Options => ({
  toolbarPosition: 'top',
  useNativeGroups: true,
  shortcut,
  theme: 'auto',
  view: 'popup',
});

const enabled: Options['shortcut'] = {
  'activate-next-group': { disabled: false },
  'activate-previous-group': { disabled: false },
  'manage-extension': { disabled: false },
};

async function setUp(
  shortcut: Options['shortcut'] = enabled,
  groups: Group[] | null = [group(1), group(2), group(3)],
  active: number | null = 2,
) {
  const groupState = createMemoryGroupState();
  if (groups !== null) {
    await groupState.setGroups(WINDOW, groups);
  }
  if (active !== null) {
    await groupState.setActiveGroup(WINDOW, active);
  }
  const extension = createMemoryExtension();
  const showGroup = vi.fn().mockResolvedValue(undefined);
  const logger = { warn: vi.fn() };
  return {
    run: createCommands({
      windows: createMemoryWindows(WINDOW),
      groupState,
      options: { load: () => Promise.resolve(optionsWith(shortcut)) },
      extension,
      showGroup,
      logger,
    }),
    groupState,
    extension,
    showGroup,
    logger,
  };
}

describe('app/commands.ts', () => {
  it('shows the next group and makes it the active one', async () => {
    const env = await setUp();

    await env.run('activate-next-group');

    expect(await env.groupState.getActiveGroup(WINDOW)).toBe(3);
    expect(env.showGroup).toHaveBeenCalledTimes(1);
    expect(env.showGroup).toHaveBeenCalledWith(3);
  });

  it('shows the previous group and makes it the active one', async () => {
    const env = await setUp();

    await env.run('activate-previous-group');

    expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
    expect(env.showGroup).toHaveBeenCalledWith(1);
  });

  it('wraps round', async () => {
    const env = await setUp(enabled, [group(1), group(2), group(3)], 3);

    await env.run('activate-next-group');

    expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
  });

  it('does not stop on the group for ungrouped tabs', async () => {
    const env = await setUp(enabled, [group(1), group(-2)], 1);

    await env.run('activate-next-group');

    expect(await env.groupState.getActiveGroup(WINDOW)).toBe(1);
  });

  it('opens the options page', async () => {
    const env = await setUp();

    await env.run('manage-extension');

    expect(env.extension.optionsOpened).toBe(1);
    expect(env.showGroup).not.toHaveBeenCalled();
  });

  it.each([
    ['activate-next-group'],
    ['activate-previous-group'],
    ['manage-extension'],
  ])('does nothing for %s when it is disabled', async (command) => {
    const env = await setUp({ ...enabled, [command]: { disabled: true } });

    await env.run(command);

    expect(env.showGroup).not.toHaveBeenCalled();
    expect(env.extension.optionsOpened).toBe(0);
    expect(await env.groupState.getActiveGroup(WINDOW)).toBe(2);
  });

  it('only disables the command that is disabled', async () => {
    const env = await setUp({
      ...enabled,
      'activate-previous-group': { disabled: true },
    });

    await env.run('activate-next-group');

    expect(env.showGroup).toHaveBeenCalledWith(3);
  });

  it('does nothing for a command it does not know', async () => {
    const env = await setUp();

    await env.run('something-else');

    expect(env.showGroup).not.toHaveBeenCalled();
    expect(env.extension.optionsOpened).toBe(0);
  });

  it('does nothing, but says so, when the window has no group to go to', async () => {
    const env = await setUp(enabled, null, null);

    await env.run('activate-next-group');

    expect(env.showGroup).not.toHaveBeenCalled();
    expect(env.logger.warn).toHaveBeenCalledWith(
      'No group to change to in window 3',
    );
  });
});
