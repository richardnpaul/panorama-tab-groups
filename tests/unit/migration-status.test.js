/**
 * @vitest-environment jsdom
 */

describe('migration-status.js', () => {
  let mockStatusDiv;
  let mockContainer;
  let mockRunButton;
  let mockResetButton;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    // Set up document
    document.body.innerHTML = `
      <div id="migration-status"></div>
      <div id="groups-container"></div>
      <button id="run-migration">Run Migration Now</button>
      <button id="reset-migration">Reset Migration Flag</button>
    `;

    mockStatusDiv = document.getElementById('migration-status');
    mockContainer = document.getElementById('groups-container');
    mockRunButton = document.getElementById('run-migration');
    mockResetButton = document.getElementById('reset-migration');

    // Global mocks
    global.window.alert = vi.fn();
    global.window.confirm = vi.fn().mockReturnValue(true);

    global.browser = {
      storage: {
        local: {
          get: vi
            .fn()
            .mockResolvedValue({ hybridGroupsMigrationComplete: false }),
        },
      },
      windows: {
        getCurrent: vi.fn().mockResolvedValue({ id: 1 }),
      },
      sessions: {
        getWindowValue: vi.fn().mockResolvedValue([
          { id: 1, name: 'Group 1', nativeGroupId: null },
          { id: 2, name: 'Group 2', nativeGroupId: 10 },
        ]),
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('initializes and renders correctly', async () => {
    // The module executes initialization logic on import; afterEach resets the registry
    await import('../../src/js/migration-status.js');

    // Let promises resolve
    await Promise.resolve();
    await Promise.resolve();

    expect(global.browser.storage.local.get).toHaveBeenCalledWith(
      'hybridGroupsMigrationComplete',
    );
    expect(mockStatusDiv.className).toBe('status-box warning');
    expect(mockStatusDiv.textContent).toContain('Migration Pending');

    expect(global.browser.windows.getCurrent).toHaveBeenCalled();
    expect(global.browser.sessions.getWindowValue).toHaveBeenCalledWith(
      1,
      'groups',
    );

    // Check groups container
    const items = mockContainer.querySelectorAll('.group-item');
    expect(items.length).toBe(2);
    expect(items[0].className).toContain('not-migrated');
    expect(items[1].className).toContain('migrated');
  });

  it('displays success status if migration complete', async () => {
    global.browser.storage.local.get.mockResolvedValue({
      hybridGroupsMigrationComplete: true,
    });

    await import('../../src/js/migration-status.js');

    await Promise.resolve();
    await Promise.resolve();

    expect(mockStatusDiv.className).toBe('status-box success');
    expect(mockStatusDiv.textContent).toContain('Migration Complete');
  });

  it('handles error in checkMigrationStatus', async () => {
    global.browser.storage.local.get.mockRejectedValue(
      new Error('Storage failure'),
    );

    await import('../../src/js/migration-status.js');

    await Promise.resolve();
    await Promise.resolve();

    expect(mockStatusDiv.className).toBe('status-box warning');
    expect(mockStatusDiv.textContent).toContain(
      'Error checking migration status: Storage failure',
    );
  });

  it('handles empty groups or error in loadGroups', async () => {
    global.browser.sessions.getWindowValue.mockResolvedValue([]);

    await import('../../src/js/migration-status.js');

    await Promise.resolve();
    await Promise.resolve();

    expect(mockContainer.textContent).toContain('No groups found');

    // Test error case
    global.browser.sessions.getWindowValue.mockRejectedValue(
      new Error('Session failure'),
    );

    // We can manually trigger interval to run it again
    vi.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockContainer.textContent).toContain(
      'Error loading groups: Session failure',
    );
  });

  it('handles run-migration click successfully', async () => {
    await import('../../src/js/migration-status.js');

    // Trigger click
    mockRunButton.click();

    expect(mockRunButton.disabled).toBe(true);
    expect(mockRunButton.textContent).toBe('Running migration...');

    await Promise.resolve(); // sendMessage
    await Promise.resolve(); // alerts and finally block
    await Promise.resolve(); // checkMigrationStatus
    await Promise.resolve(); // loadGroups

    expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'migrateToHybridGroups',
    });
    expect(global.window.alert).toHaveBeenCalledWith(
      'Migration completed successfully!',
    );
    expect(mockRunButton.disabled).toBe(false);
  });

  it('handles run-migration failure', async () => {
    global.browser.runtime.sendMessage.mockResolvedValue({
      success: false,
      message: 'Custom error',
    });

    await import('../../src/js/migration-status.js');

    mockRunButton.click();

    await Promise.resolve();
    await Promise.resolve();

    expect(global.window.alert).toHaveBeenCalledWith(
      'Migration failed: Custom error',
    );
  });

  it('handles run-migration throw', async () => {
    global.browser.runtime.sendMessage.mockRejectedValue(
      new Error('Network error'),
    );

    await import('../../src/js/migration-status.js');

    mockRunButton.click();

    await Promise.resolve();
    await Promise.resolve();

    expect(global.window.alert).toHaveBeenCalledWith(
      'Migration error: Network error',
    );
  });

  it('handles reset-migration click', async () => {
    await import('../../src/js/migration-status.js');

    mockResetButton.click();

    await Promise.resolve();
    await Promise.resolve();

    expect(global.window.confirm).toHaveBeenCalled();
    expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
      action: 'resetMigration',
    });
    expect(global.window.alert).toHaveBeenCalledWith(
      'Migration flag reset successfully!',
    );
  });

  it('handles reset-migration cancellation', async () => {
    global.window.confirm.mockReturnValue(false);

    await import('../../src/js/migration-status.js');

    mockResetButton.click();

    expect(global.browser.runtime.sendMessage).not.toHaveBeenCalled();
  });

  it('handles reset-migration throw', async () => {
    global.browser.runtime.sendMessage.mockRejectedValue(
      new Error('Reset failed'),
    );

    await import('../../src/js/migration-status.js');

    mockResetButton.click();

    await Promise.resolve();
    await Promise.resolve();

    expect(global.window.alert).toHaveBeenCalledWith(
      'Reset error: Reset failed',
    );
  });

  it('handles reset-migration failure', async () => {
    global.browser.runtime.sendMessage.mockResolvedValue({
      success: false,
    });

    await import('../../src/js/migration-status.js');

    mockResetButton.click();

    await Promise.resolve();
    await Promise.resolve();

    expect(global.window.alert).not.toHaveBeenCalled();
  });
});
