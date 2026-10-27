// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFakeSessions } from '../../support/fake-sessions.js';
import { flush } from '../../support/popup-page.js';

const WINDOW = 2;

const PAGE = `
  <div id="migration-status"></div>
  <div id="groups-container"></div>
  <button id="run-migration">Run Migration Now</button>
  <button id="reset-migration">Reset Migration Flag</button>`;

async function load(options: { page?: boolean; complete?: boolean } = {}) {
  vi.resetModules();
  const { page = true, complete = true } = options;
  document.body.innerHTML = page ? PAGE : '';

  const sessions = createFakeSessions();
  await sessions.api.sessions.setWindowValue(WINDOW, 'groups', [
    {
      id: 1,
      name: 'Work',
      containerId: 'firefox-default',
      rect: { x: 0, y: 0, w: 1, h: 1 },
      nativeGroupId: 5,
    },
  ]);
  const browserFake = {
    runtime: {
      getManifest: () => ({ version: '2.0' }),
      sendMessage: vi.fn().mockResolvedValue({ success: true }),
    },
    storage: {
      local: {
        get: vi
          .fn()
          .mockResolvedValue({ hybridGroupsMigrationComplete: complete }),
      },
    },
    sessions: sessions.api.sessions,
    windows: { getCurrent: vi.fn().mockResolvedValue({ id: WINDOW }) },
  };
  vi.stubGlobal('browser', browserFake);
  const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(console, 'debug').mockImplementation(() => undefined);

  const { startMigrationStatus } =
    await import('../../../src/js/migration-status/start.js');
  return { startMigrationStatus, browser: browserFake, alert, confirm };
}

describe('migration-status/start.ts', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('shows the status and the groups', async () => {
    const env = await load();

    await env.startMigrationStatus();

    expect(document.getElementById('migration-status')?.className).toBe(
      'status-box success',
    );
    expect(document.getElementById('groups-container')?.textContent).toBe(
      'Group 1: WorkStatus: ✓ Migrated (Native ID: 5)',
    );
  });

  it('fails when the page lacks what it shows in', async () => {
    const env = await load({ page: false });

    await expect(env.startMigrationStatus()).rejects.toThrow(
      'Element not found: #migration-status',
    );
  });

  it('runs the migration with the button, and tells the user with an alert', async () => {
    const env = await load();
    await env.startMigrationStatus();

    document.getElementById('run-migration')?.click();
    await flush();

    expect(env.browser.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'migrateToHybridGroups',
    });
    expect(env.alert).toHaveBeenCalledWith('Migration completed successfully!');
  });

  it('resets the migration with the button after asking', async () => {
    const env = await load();
    await env.startMigrationStatus();

    document.getElementById('reset-migration')?.click();
    await flush();

    expect(env.confirm).toHaveBeenCalledTimes(1);
    expect(env.browser.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'resetMigration',
    });
    expect(env.alert).toHaveBeenCalledWith(
      'Migration flag reset successfully!',
    );
  });

  it('looks again in five seconds', async () => {
    vi.useFakeTimers();
    const env = await load();
    await env.startMigrationStatus();
    expect(env.browser.storage.local.get).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5000);

    expect(env.browser.storage.local.get).toHaveBeenCalledTimes(2);
  });
});

describe('migration-status/index.ts', () => {
  afterEach(() => {
    vi.doUnmock('../../../src/js/polyfill.js');
    vi.doUnmock('../../../src/js/migration-status/start.js');
    vi.restoreAllMocks();
  });

  it('starts the page', async () => {
    vi.resetModules();
    const startMigrationStatus = vi.fn().mockResolvedValue(undefined);
    vi.doMock('../../../src/js/polyfill.js', () => ({}));
    vi.doMock('../../../src/js/migration-status/start.js', () => ({
      startMigrationStatus,
    }));

    await import('../../../src/js/migration-status/index.js');

    expect(startMigrationStatus).toHaveBeenCalledTimes(1);
  });

  it('says so when it cannot', async () => {
    vi.resetModules();
    const failure = new Error('no page');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    vi.doMock('../../../src/js/polyfill.js', () => ({}));
    vi.doMock('../../../src/js/migration-status/start.js', () => ({
      startMigrationStatus: vi.fn().mockRejectedValue(failure),
    }));

    await import('../../../src/js/migration-status/index.js');
    await flush();

    expect(error).toHaveBeenCalledWith('[Migration] Start-up failed:', failure);
  });
});
