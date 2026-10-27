import type { Logger } from '../ports/logger.js';

const COMMANDS = ['activate-next-group', 'activate-previous-group'];

/**
 * What other extensions may ask of this one: to switch to the next or the
 * previous group, as the shortcuts do.
 */
export function createExternalMessageHandler({
  triggerCommand,
  logger,
}: {
  triggerCommand: (command: string) => Promise<void>;
  logger: Pick<Logger, 'error'>;
}): (message: unknown) => Promise<void> {
  return async (message) => {
    if (typeof message === 'string' && COMMANDS.includes(message)) {
      await triggerCommand(message);
    } else {
      logger.error('Unknown external message:', message);
    }
  };
}
