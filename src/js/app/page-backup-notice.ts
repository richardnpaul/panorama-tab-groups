import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Messaging } from '../ports/messaging.js';
import { withBackupOnChange } from './auto-backup.js';

/**
 * The group state of an extension page (the view, the popup): the groups are stored from the page
 * itself, so the background, which writes the automatic backups, is told of each change. The
 * message carries nothing; the backup reads the groups as they are stored.
 */
export function withBackupNotice(
  inner: GroupState,
  messaging: Messaging,
  logger: Pick<Logger, 'debug'>,
): GroupState {
  return withBackupOnChange(inner, {
    changed: () => {
      // The background may be starting again; the next change tells it
      messaging.send({ action: 'groupsChanged' }).catch((error: unknown) => {
        logger.debug(
          '[AutoBackup] The background was not told of a change:',
          error,
        );
      });
    },
  });
}
