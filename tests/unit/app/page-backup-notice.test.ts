import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { withBackupNotice } from '../../../src/js/app/page-backup-notice.js';

function setUp() {
  const messaging = { send: vi.fn().mockResolvedValue(undefined) };
  const logger = { debug: vi.fn() };
  const state = withBackupNotice(createMemoryGroupState(), messaging, logger);
  return { state, messaging, logger };
}

describe('app/page-backup-notice.ts', () => {
  it('tells the background of a change once it is stored, with a message that carries nothing', async () => {
    const { state, messaging } = setUp();

    await state.setGroups(1, []);

    expect(await state.getGroups(1)).toEqual([]);
    expect(messaging.send).toHaveBeenCalledTimes(1);
    expect(messaging.send).toHaveBeenCalledWith({ action: 'groupsChanged' });
  });

  it('says nothing of what is only read', async () => {
    const { state, messaging } = setUp();

    await state.getGroups(1);
    await state.getTabGroup(10);

    expect(messaging.send).not.toHaveBeenCalled();
  });

  it('goes on, and says so, when the background cannot be told', async () => {
    const { state, messaging, logger } = setUp();
    const failure = new Error('Could not establish connection');
    messaging.send.mockRejectedValue(failure);

    await expect(state.setTabGroup(10, 2)).resolves.toBeUndefined();
    await vi.waitFor(() => {
      expect(logger.debug).toHaveBeenCalledWith(
        '[AutoBackup] The background was not told of a change:',
        failure,
      );
    });
  });
});
