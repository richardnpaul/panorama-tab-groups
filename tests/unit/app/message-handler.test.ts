import { describe, expect, it, vi } from 'vitest';
import { createMessageHandler } from '../../../src/js/app/message-handler.js';

function setUp() {
  const deps = {
    handleMenuChange: vi.fn().mockResolvedValue(undefined),
    deleteGroup: vi.fn().mockResolvedValue({ success: true }),
    nativeGroupsSync: {
      migrate: vi.fn().mockResolvedValue(true),
      cleanup: vi.fn().mockResolvedValue(undefined),
    },
    migrationFlag: { setComplete: vi.fn().mockResolvedValue(undefined) },
    viewRefresh: {
      refreshView: vi.fn().mockResolvedValue(undefined),
      isOrdered: vi.fn().mockReturnValue(false),
      clear: vi.fn(),
    },
    setOpeningBackup: vi.fn(),
    logger: { error: vi.fn() },
  };
  return { handle: createMessageHandler(deps), deps };
}

describe('app/message-handler.ts', () => {
  it.each([['createMenuItem'], ['updateMenuItem'], ['removeMenuItem']])(
    'passes the message of %s to the menu, and answers nothing',
    async (action) => {
      const { handle, deps } = setUp();
      const message = { action, groupId: 3, groupName: 'Work' };

      await expect(handle(message)).resolves.toBeUndefined();

      expect(deps.handleMenuChange).toHaveBeenCalledTimes(1);
      expect(deps.handleMenuChange).toHaveBeenCalledWith(message);
    },
  );

  describe('deleteGroup', () => {
    const message = {
      action: 'deleteGroup',
      groupId: 3,
      windowId: 7,
      nativeGroupId: 55,
      tabIds: [1, 2],
    };

    it('deletes the group and gives the result', async () => {
      const { handle, deps } = setUp();
      deps.deleteGroup.mockResolvedValue({ success: false, error: 'no' });

      await expect(handle(message)).resolves.toEqual({
        success: false,
        error: 'no',
      });

      expect(deps.deleteGroup).toHaveBeenCalledWith({
        groupId: 3,
        windowId: 7,
        nativeGroupId: 55,
        tabIds: [1, 2],
      });
    });

    it('refuses a message that is not complete, without deleting anything', async () => {
      const { handle, deps } = setUp();

      await expect(handle({ ...message, tabIds: 'all' })).resolves.toEqual({
        success: false,
        error: 'Invalid deleteGroup message',
      });

      expect(deps.deleteGroup).not.toHaveBeenCalled();
    });
  });

  describe('cleanupNativeGroups', () => {
    it('cleans up and says it worked', async () => {
      const { handle, deps } = setUp();

      await expect(handle({ action: 'cleanupNativeGroups' })).resolves.toEqual({
        success: true,
      });

      expect(deps.nativeGroupsSync.cleanup).toHaveBeenCalledTimes(1);
    });

    it('says why it failed', async () => {
      const { handle, deps } = setUp();
      const failure = new Error('storage');
      deps.nativeGroupsSync.cleanup.mockRejectedValue(failure);

      await expect(handle({ action: 'cleanupNativeGroups' })).resolves.toEqual({
        success: false,
        error: 'storage',
      });

      expect(deps.logger.error).toHaveBeenCalledWith(
        '[Message] Cleanup failed:',
        failure,
      );
    });

    it('says why it failed when that is not an error', async () => {
      const { handle, deps } = setUp();
      deps.nativeGroupsSync.cleanup.mockRejectedValue('broken');

      await expect(handle({ action: 'cleanupNativeGroups' })).resolves.toEqual({
        success: false,
        error: 'broken',
      });
    });
  });

  describe('migrateToHybridGroups', () => {
    it('migrates and says it completed', async () => {
      const { handle, deps } = setUp();

      await expect(
        handle({ action: 'migrateToHybridGroups' }),
      ).resolves.toEqual({
        success: true,
        message: 'Migration completed',
      });

      expect(deps.nativeGroupsSync.migrate).toHaveBeenCalledTimes(1);
    });

    it('says when it did not', async () => {
      const { handle, deps } = setUp();
      deps.nativeGroupsSync.migrate.mockResolvedValue(false);

      await expect(
        handle({ action: 'migrateToHybridGroups' }),
      ).resolves.toEqual({
        success: false,
        message: 'Migration failed',
      });
    });
  });

  describe('resetMigration', () => {
    it('clears the flag and says so', async () => {
      const { handle, deps } = setUp();

      await expect(handle({ action: 'resetMigration' })).resolves.toEqual({
        success: true,
        message: 'Migration flag reset',
      });

      expect(deps.migrationFlag.setComplete).toHaveBeenCalledWith(false);
    });

    it('says why it could not', async () => {
      const { handle, deps } = setUp();
      deps.migrationFlag.setComplete.mockRejectedValue(new Error('storage'));

      await expect(handle({ action: 'resetMigration' })).resolves.toEqual({
        success: false,
        message: 'storage',
      });
    });

    it('says why it could not when that is not an error', async () => {
      const { handle, deps } = setUp();
      deps.migrationFlag.setComplete.mockRejectedValue('broken');

      await expect(handle({ action: 'resetMigration' })).resolves.toEqual({
        success: false,
        message: 'broken',
      });
    });
  });

  describe('setBackgroundState', () => {
    it.each([[true], [false]])(
      'tells whether a backup is being opened: %s',
      async (value) => {
        const { handle, deps } = setUp();

        await expect(
          handle({ action: 'setBackgroundState', key: 'openingBackup', value }),
        ).resolves.toBeUndefined();

        expect(deps.setOpeningBackup).toHaveBeenCalledTimes(1);
        expect(deps.setOpeningBackup).toHaveBeenCalledWith(value);
      },
    );

    it.each([
      [{ key: 'openingView', value: true }],
      [{ key: 'openingBackup', value: 'yes' }],
      [{}],
    ])('refuses to set %j', async (state) => {
      const { handle, deps } = setUp();

      await expect(
        handle({ action: 'setBackgroundState', ...state }),
      ).resolves.toEqual({ error: 'Invalid setBackgroundState message' });

      expect(deps.setOpeningBackup).not.toHaveBeenCalled();
    });
  });

  describe('the refresh of the view', () => {
    it('orders it', async () => {
      const { handle, deps } = setUp();

      await expect(handle({ action: 'refreshView' })).resolves.toBeUndefined();

      expect(deps.viewRefresh.refreshView).toHaveBeenCalledTimes(1);
    });

    it.each([[true], [false]])(
      'tells whether it is ordered: %s',
      async (ordered) => {
        const { handle, deps } = setUp();
        deps.viewRefresh.isOrdered.mockReturnValue(ordered);

        await expect(handle({ action: 'checkViewRefresh' })).resolves.toEqual({
          viewRefreshOrdered: ordered,
        });
      },
    );

    it('ends the order', async () => {
      const { handle, deps } = setUp();

      await expect(
        handle({ action: 'clearViewRefresh' }),
      ).resolves.toBeUndefined();

      expect(deps.viewRefresh.clear).toHaveBeenCalledTimes(1);
    });
  });

  describe('what it does not know', () => {
    it('answers that the action is unknown, and logs it', async () => {
      const { handle, deps } = setUp();
      const message = { action: 'dance' };

      await expect(handle(message)).resolves.toEqual({
        error: 'Unknown action: dance',
      });

      expect(deps.logger.error).toHaveBeenCalledWith(
        'Unknown internal message action:',
        message,
      );
    });

    it.each([[undefined], [null], ['createMenuItem'], [{}]])(
      'answers that a message that is not an action is unknown: %j',
      async (message) => {
        const { handle } = setUp();

        await expect(handle(message)).resolves.toEqual({
          error: 'Unknown action: undefined',
        });
      },
    );

    it('does not take a name that objects have for an action', async () => {
      const { handle } = setUp();

      await expect(handle({ action: 'toString' })).resolves.toEqual({
        error: 'Unknown action: toString',
      });
    });
  });
});
