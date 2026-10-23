// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryMigrationFlag } from '../../../src/js/adapters/memory/migration-flag.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import {
  createMigrationStatusPage,
  REFRESH_MS,
} from '../../../src/js/migration-status/status-page.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import { flush } from '../../support/popup-page.js';

const WINDOW = 4;

const stored = (
  id: number,
  name: string,
  nativeGroupId?: number | null,
): Group => ({
  id,
  name,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 0.5, h: 0.5 },
  ...(nativeGroupId === undefined ? {} : { nativeGroupId }),
});

function setUp(options: { complete?: boolean; groups?: Group[] | null } = {}) {
  const { complete = false, groups = [] } = options;
  document.body.innerHTML = `
    <div id="migration-status" class="status-box info">Checking...</div>
    <div id="groups-container">Loading groups...</div>
    <button id="run-migration">Run Migration Now</button>
    <button id="reset-migration">Reset Migration Flag</button>`;
  const element = <T extends HTMLElement>(id: string, type: new () => T): T => {
    const found = document.getElementById(id);
    if (!(found instanceof type)) {
      throw new Error(`No #${id}`);
    }
    return found;
  };
  const nodes = {
    status: element('migration-status', HTMLElement),
    groups: element('groups-container', HTMLElement),
    runButton: element('run-migration', HTMLButtonElement),
    resetButton: element('reset-migration', HTMLElement),
  };
  const migrationFlag = createMemoryMigrationFlag(complete);
  const groupState = createMemoryGroupState();
  const windows = createMemoryWindows(WINDOW);
  const messaging = createMemoryMessaging();
  messaging.reply({ success: true });
  const scheduler = createMemoryScheduler();
  const alert = vi.fn();
  const confirm = vi.fn().mockReturnValue(true);
  const logger = { error: vi.fn() };
  const page = createMigrationStatusPage({
    nodes,
    migrationFlag,
    groupState,
    windows,
    messaging,
    scheduler,
    alert,
    confirm,
    logger,
  });
  const ready =
    groups === null ? Promise.resolve() : groupState.setGroups(WINDOW, groups);
  return {
    ...page,
    nodes,
    migrationFlag,
    groupState,
    windows,
    messaging,
    scheduler,
    alert,
    confirm,
    logger,
    ready,
  };
}

const started = async (options: Parameters<typeof setUp>[0] = {}) => {
  const env = setUp(options);
  await env.ready;
  await env.start();
  return env;
};

describe('migration-status/status-page.ts', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('the status', () => {
    it('says the migration is complete', async () => {
      const env = await started({ complete: true });

      expect(env.nodes.status.className).toBe('status-box success');
      expect(env.nodes.status.textContent).toBe(
        '✓ Migration Complete - All groups have been migrated to hybrid system',
      );
    });

    it('says the migration is pending', async () => {
      const env = await started({ complete: false });

      expect(env.nodes.status.className).toBe('status-box warning');
      expect(env.nodes.status.textContent).toBe(
        '⚠ Migration Pending - Groups have not been migrated yet',
      );
    });

    it('says why the status is not known', async () => {
      const env = setUp();
      env.migrationFlag.failWith(new Error('no storage'));
      await env.ready;

      await env.start();

      expect(env.nodes.status.className).toBe('status-box warning');
      expect(env.nodes.status.textContent).toBe(
        'Error checking migration status: no storage',
      );
    });

    it('says what was thrown when it is not an error', async () => {
      const env = setUp();
      vi.spyOn(env.migrationFlag, 'isComplete').mockRejectedValue('plain');
      await env.ready;

      await env.start();

      expect(env.nodes.status.textContent).toBe(
        'Error checking migration status: plain',
      );
    });
  });

  describe('the groups', () => {
    it('lists the groups of the window, and whether they were migrated', async () => {
      const env = await started({
        groups: [
          stored(1, 'First', 17),
          stored(2, 'Second'),
          stored(3, 'Third', null),
        ],
      });

      const items = Array.from(env.nodes.groups.children);
      expect(items.map((item) => item.className)).toEqual([
        'group-item migrated',
        'group-item not-migrated',
        'group-item not-migrated',
      ]);
      expect(items.map((item) => item.textContent)).toEqual([
        'Group 1: FirstStatus: ✓ Migrated (Native ID: 17)',
        'Group 2: SecondStatus: ✗ Not Migrated',
        'Group 3: ThirdStatus: ✗ Not Migrated',
      ]);
    });

    it('shows each group as a name in bold, a line break, and the status in small print', async () => {
      const env = await started({ groups: [stored(1, 'First', 17)] });

      const [item] = Array.from(env.nodes.groups.children);
      expect(
        Array.from(item?.childNodes ?? []).map((node) => node.nodeName),
      ).toEqual(['STRONG', '#text', 'BR', 'SMALL']);
      expect(item?.querySelector('strong')?.textContent).toBe('Group 1:');
      expect(item?.querySelector('small')?.textContent).toBe(
        'Status: ✓ Migrated (Native ID: 17)',
      );
    });

    it('shows a native group of 0 as migrated', async () => {
      const env = await started({ groups: [stored(1, 'Zero', 0)] });

      expect(env.nodes.groups.children[0]?.className).toBe(
        'group-item migrated',
      );
    });

    it('shows the name of a group as text', async () => {
      const hostile = '<img src=x onerror=alert(1)>';
      const env = await started({ groups: [stored(1, hostile)] });

      expect(env.nodes.groups.querySelector('img')).toBeNull();
      expect(env.nodes.groups.textContent).toContain(hostile);
    });

    it('says when the window has no groups', async () => {
      const env = await started({ groups: [] });

      expect(env.nodes.groups.textContent).toBe(
        'No groups found in current window',
      );
      expect(env.nodes.groups.children).toHaveLength(0);
    });

    it('says when the window has never had groups', async () => {
      const env = await started({ groups: null });

      expect(env.nodes.groups.textContent).toBe(
        'No groups found in current window',
      );
    });

    it('says why the groups are not known', async () => {
      const env = setUp();
      vi.spyOn(env.groupState, 'getGroups').mockRejectedValue(
        new Error('no sessions'),
      );
      await env.ready;

      await env.start();

      expect(env.nodes.groups.textContent).toBe(
        'Error loading groups: no sessions',
      );
    });

    it('lists the groups of the window the page is in', async () => {
      const env = setUp({ groups: null });
      await env.groupState.setGroups(WINDOW, [stored(1, 'Mine')]);
      await env.groupState.setGroups(WINDOW + 1, [stored(2, 'Other')]);

      await env.start();

      expect(env.nodes.groups.textContent).toContain('Mine');
      expect(env.nodes.groups.textContent).not.toContain('Other');
    });
  });

  describe('keeping up to date', () => {
    it('looks again every five seconds', async () => {
      const env = await started({ groups: [stored(1, 'First')] });
      await env.groupState.setGroups(WINDOW, [
        stored(1, 'First'),
        stored(2, 'Second'),
      ]);
      await env.migrationFlag.setComplete(true);

      env.scheduler.advance(REFRESH_MS - 1);
      await flush();
      expect(env.nodes.groups.children).toHaveLength(1);

      env.scheduler.advance(1);
      await flush();
      expect(env.nodes.groups.children).toHaveLength(2);
      expect(env.nodes.status.className).toBe('status-box success');
    });

    it('looks again after each look', async () => {
      const env = await started({ groups: [stored(1, 'First')] });
      env.scheduler.advance(REFRESH_MS);
      await flush();
      await env.groupState.setGroups(WINDOW, []);

      env.scheduler.advance(REFRESH_MS);
      await flush();

      expect(env.nodes.groups.textContent).toBe(
        'No groups found in current window',
      );
      expect(env.scheduler.pending()).toBe(1);
    });

    it('does not look before it is told to start', () => {
      const env = setUp();

      expect(env.scheduler.pending()).toBe(0);
    });

    it('does not empty the list while it looks again', async () => {
      const env = await started({ groups: [stored(1, 'First')] });
      const item = env.nodes.groups.children[0];
      env.scheduler.advance(REFRESH_MS);

      expect(env.nodes.groups.children[0]).toBe(item);
      await flush();
    });
  });

  describe('the button to run the migration', () => {
    const run = async (env: Awaited<ReturnType<typeof started>>) => {
      env.nodes.runButton.click();
      await flush();
    };

    it('asks the background, says it worked, and looks again', async () => {
      const env = await started({ complete: false });
      await env.migrationFlag.setComplete(true);

      await run(env);

      expect(env.messaging.sent).toEqual([{ action: 'migrateToHybridGroups' }]);
      expect(env.alert).toHaveBeenCalledWith(
        'Migration completed successfully!',
      );
      expect(env.nodes.status.className).toBe('status-box success');
    });

    it('is disabled while it runs, and is as it was after', async () => {
      const env = await started();
      let release: (answer: unknown) => void = () => undefined;
      vi.spyOn(env.messaging, 'send').mockReturnValue(
        new Promise((resolve) => {
          release = resolve;
        }),
      );

      env.nodes.runButton.click();
      await flush();
      expect(env.nodes.runButton.disabled).toBe(true);
      expect(env.nodes.runButton.textContent).toBe('Running migration...');

      release({ success: true });
      await flush();
      expect(env.nodes.runButton.disabled).toBe(false);
      expect(env.nodes.runButton.textContent).toBe('Run Migration Now');
    });

    it('says why it failed', async () => {
      const env = await started();
      env.messaging.reply({ success: false, message: 'Migration failed' });

      await run(env);

      expect(env.alert).toHaveBeenCalledWith(
        'Migration failed: Migration failed',
      );
    });

    it('says when it was not answered', async () => {
      const env = await started();
      env.messaging.reply(undefined);

      await run(env);

      expect(env.alert).toHaveBeenCalledWith('Migration failed: No response');
    });

    it('says when the answer has no reason', async () => {
      const env = await started();
      env.messaging.reply({ success: false });

      await run(env);

      expect(env.alert).toHaveBeenCalledWith('Migration failed: No response');
    });

    it('says when the answer is not that it worked', async () => {
      const env = await started();
      env.messaging.reply({ success: 'yes' });

      await run(env);

      expect(env.alert).toHaveBeenCalledWith('Migration failed: No response');
    });

    it('says when the background could not be asked, and is as it was after', async () => {
      const env = await started();
      env.messaging.fail(new Error('no background'));

      await run(env);

      expect(env.alert).toHaveBeenCalledWith('Migration error: no background');
      expect(env.nodes.runButton.disabled).toBe(false);
      expect(env.nodes.runButton.textContent).toBe('Run Migration Now');
    });
  });

  describe('the button to reset the migration', () => {
    const reset = async (env: Awaited<ReturnType<typeof started>>) => {
      env.nodes.resetButton.click();
      await flush();
    };

    it('asks first', async () => {
      const env = await started();

      await reset(env);

      expect(env.confirm).toHaveBeenCalledWith(
        'Reset migration flag? This will allow migration to run again.',
      );
    });

    it('does nothing when the user does not want it', async () => {
      const env = await started();
      env.confirm.mockReturnValue(false);

      await reset(env);

      expect(env.messaging.sent).toEqual([]);
      expect(env.alert).not.toHaveBeenCalled();
    });

    it('asks the background, says it worked, and looks at the status again', async () => {
      const env = await started({ complete: true });
      await env.migrationFlag.setComplete(false);

      await reset(env);

      expect(env.messaging.sent).toEqual([{ action: 'resetMigration' }]);
      expect(env.alert).toHaveBeenCalledWith(
        'Migration flag reset successfully!',
      );
      expect(env.nodes.status.className).toBe('status-box warning');
    });

    it('says why it failed', async () => {
      const env = await started();
      env.messaging.reply({ success: false, message: 'no storage' });

      await reset(env);

      expect(env.alert).toHaveBeenCalledWith('Reset failed: no storage');
    });

    it('says when the background could not be asked', async () => {
      const env = await started();
      env.messaging.fail(new Error('no background'));

      await reset(env);

      expect(env.alert).toHaveBeenCalledWith('Reset error: no background');
    });

    it('does not run the migration', async () => {
      const env = await started();

      await reset(env);

      expect(env.messaging.sent).not.toContainEqual({
        action: 'migrateToHybridGroups',
      });
    });
  });

  it('reports an action that failed', async () => {
    const env = await started();
    env.alert.mockImplementation(() => {
      throw new Error('no alerts');
    });

    env.nodes.runButton.click();
    await flush();

    expect(env.logger.error).toHaveBeenCalledWith(
      '[Migration] An action failed:',
      expect.objectContaining({ message: 'no alerts' }),
    );
  });
});
