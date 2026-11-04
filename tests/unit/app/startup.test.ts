import { describe, expect, it, vi } from 'vitest';
import { createStartup } from '../../../src/js/app/startup.js';

function setUp(useNativeGroups = true) {
  const order: string[] = [];
  const step = (name: string) =>
    vi.fn(() => {
      order.push(name);
      return Promise.resolve();
    });
  const deps = {
    migrations: { atStart: step('migrate data') },
    firstRun: { decideNativeGroups: step('firstRun') },
    windowRebuild: { rebuildAll: step('rebuild') },
    closedWindows: { prune: step('prune') },
    recovery: {
      initializeTabGroupAssignments: step('recover'),
      salvageGrouplessTabs: step('salvage'),
    },
    windowGroups: { setupWindows: step('setupWindows') },
    nativeGroupsSync: {
      relink: step('relink'),
      migrate: vi.fn(() => {
        order.push('migrate');
        return Promise.resolve(true);
      }),
    },
    menuManager: { createMenuList: step('menu') },
    viewRefresh: { applyPopup: step('popup') },
    autoBackup: {
      start: vi.fn(() => {
        order.push('backups');
      }),
    },
    useNativeGroups: vi.fn(() => Promise.resolve(useNativeGroups)),
    logger: {
      debug: vi.fn((message: string) => {
        order.push(message);
      }),
    },
  };
  return { init: createStartup(deps), deps, order };
}

describe('app/startup.ts', () => {
  it('decides about native groups first, then brings the stored data up, recovers the groups of the tabs, and builds on them', async () => {
    const env = setUp();

    await env.init();

    expect(env.order).toEqual([
      'Initializing Tab Groups Viewer',
      'firstRun',
      'migrate data',
      'rebuild',
      'recover',
      'setupWindows',
      'salvage',
      'prune',
      'relink',
      'migrate',
      'menu',
      'popup',
      'backups',
      'Finished setup',
    ]);
  });

  it('does not migrate to native groups where there are none, or where the user does not want them', async () => {
    const env = setUp(false);

    await env.init();

    expect(env.deps.nativeGroupsSync.relink).not.toHaveBeenCalled();
    expect(env.deps.nativeGroupsSync.migrate).not.toHaveBeenCalled();
    expect(env.order).toContain('menu');
  });

  type Deps = ReturnType<typeof setUp>['deps'];
  const steps: [string, (deps: Deps) => ReturnType<typeof vi.fn>][] = [
    ['migrate data', (deps) => deps.migrations.atStart],
    ['rebuild', (deps) => deps.windowRebuild.rebuildAll],
    ['firstRun', (deps) => deps.firstRun.decideNativeGroups],
    ['recover', (deps) => deps.recovery.initializeTabGroupAssignments],
    ['setupWindows', (deps) => deps.windowGroups.setupWindows],
    ['salvage', (deps) => deps.recovery.salvageGrouplessTabs],
    ['prune', (deps) => deps.closedWindows.prune],
    ['relink', (deps) => deps.nativeGroupsSync.relink],
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
      // Nothing is backed up from what start-up could not finish putting together
      expect(env.deps.autoBackup.start).not.toHaveBeenCalled();
    },
  );
});
