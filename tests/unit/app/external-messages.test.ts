import { describe, expect, it, vi } from 'vitest';
import { createExternalMessageHandler } from '../../../src/js/app/external-messages.js';

function setUp() {
  const triggerCommand = vi.fn().mockResolvedValue(undefined);
  const logger = { error: vi.fn() };
  return {
    handle: createExternalMessageHandler({ triggerCommand, logger }),
    triggerCommand,
    logger,
  };
}

describe('app/external-messages.ts', () => {
  it.each([['activate-next-group'], ['activate-previous-group']])(
    'does what the shortcut %s does',
    async (command) => {
      const { handle, triggerCommand, logger } = setUp();

      await handle(command);

      expect(triggerCommand).toHaveBeenCalledTimes(1);
      expect(triggerCommand).toHaveBeenCalledWith(command);
      expect(logger.error).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['manage-extension'],
    ['unknown'],
    [''],
    [undefined],
    [{ action: 'activate-next-group' }],
    [['activate-next-group']],
  ])('refuses %j, and says so', async (message) => {
    const { handle, triggerCommand, logger } = setUp();

    await handle(message);

    expect(triggerCommand).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Unknown external message:',
      message,
    );
  });
});
