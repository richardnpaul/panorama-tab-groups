import { describe, expect, it, vi } from 'vitest';
import { createStartup } from '../../../src/js/app/startup.js';

function setUp(hasTabGroups = true) {
  const order: string[] = [];
  const step = (name: string) =>
    vi.fn(() => {
      order.push(name);
      return Promise.resolve();
    });
  const deps = {
    recovery: {
      initializeTabGroupAssignments: step('recover'),
      salvageGrouplessTabs: step('salvage'),
    },
    windowGroups: { setupWindows: step('setupWindows') },
    nativeGroupsSync: {
      migrate: vi.fn(() => {
        order.push('migrate');
        return Promise.resolve(true);
      }),
    },
    menuManager: { createMenuList: step('menu') },
    viewRefresh: { applyPopup: step('popup') },
    hasTabGroups,
    logger: {
      debug: vi.fn((message: string) => {
        order.push(message);
      }),
    },
  };
  return { init: createStartup(deps), deps, order };
}

describe('app/startup.ts', () => {
  it('recovers the groups of the tabs first, then builds on them', async () => {
    const env = setUp();

    await env.init();

    expect(env.order).toEqual([
      'Initializing Panorama Tab View',
      'recover',
      'setupWindows',
      'salvage',
      'migrate',
      'menu',
      'popup',
      'Finished setup',
    ]);
  });

  it('does not migrate to native groups where there are none', async () => {
    const env = setUp(false);

    await env.init();

    expect(env.deps.nativeGroupsSync.migrate).not.toHaveBeenCalled();
    expect(env.order).toContain('menu');
  });

  type Deps = ReturnType<typeof setUp>['deps'];
  const steps: [string, (deps: Deps) => ReturnType<typeof vi.fn>][] = [
    ['recover', (deps) => deps.recovery.initializeTabGroupAssignments],
    ['setupWindows', (deps) => deps.windowGroups.setupWindows],
    ['salvage', (deps) => deps.recovery.salvageGrouplessTabs],
    ['menu', (deps) => deps.menuManager.createMenuList],
    ['popup', (deps) => deps.viewRefresh.applyPopup],
  ];

  it.each(steps)(
    'stops where %s fails, and says so by failing',
    async (name, stepOf) => {
      const env = setUp();
      const failure = new Error(`${name} failed`);
      stepOf(env.deps).mockRejectedValue(failure);

      await expect(env.init()).rejects.toBe(failure);

      expect(env.order).not.toContain('Finished setup');
    },
  );
});
