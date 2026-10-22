import {
  openEnvelope,
  parseGroupDeletion,
  parseOpeningBackup,
  type GroupDeletionRequest,
} from '../core/messages.js';
import type { Logger } from '../ports/logger.js';
import type { MigrationFlag } from '../ports/migration-flag.js';
import type { DeletionResult } from './delete-group.js';
import type { NativeGroupsSync } from './native-groups-sync.js';
import type { ViewRefresh } from './view-refresh.js';

export interface MessageHandlerDeps {
  // Create, rename or remove the menu item of a group
  handleMenuChange: (message: unknown) => Promise<void>;
  deleteGroup: (deletion: GroupDeletionRequest) => Promise<DeletionResult>;
  nativeGroupsSync: Pick<NativeGroupsSync, 'migrate' | 'cleanup'>;
  migrationFlag: Pick<MigrationFlag, 'setComplete'>;
  viewRefresh: Pick<ViewRefresh, 'refreshView' | 'isOrdered' | 'clear'>;
  setOpeningBackup: (opening: boolean) => void;
  logger: Pick<Logger, 'error'>;
}

type Handler = (message: Record<string, unknown>) => Promise<unknown>;

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * What the extension's own pages ask of the background. Gives what to answer
 * them: nothing for most, an answer for those that ask for one.
 */
export function createMessageHandler({
  handleMenuChange,
  deleteGroup,
  nativeGroupsSync,
  migrationFlag,
  viewRefresh,
  setOpeningBackup,
  logger,
}: MessageHandlerDeps): (message: unknown) => Promise<unknown> {
  const changeMenu: Handler = (message) => handleMenuChange(message);

  const handlers = new Map<string, Handler>([
    ['createMenuItem', changeMenu],
    ['updateMenuItem', changeMenu],
    ['removeMenuItem', changeMenu],

    [
      'deleteGroup',
      (message) => {
        const deletion = parseGroupDeletion(message);
        return deletion === undefined
          ? Promise.resolve({
              success: false,
              error: 'Invalid deleteGroup message',
            })
          : deleteGroup(deletion);
      },
    ],

    [
      'cleanupNativeGroups',
      async () => {
        try {
          await nativeGroupsSync.cleanup();
          return { success: true };
        } catch (error) {
          logger.error('[Message] Cleanup failed:', error);
          return { success: false, error: messageOf(error) };
        }
      },
    ],

    [
      'migrateToHybridGroups',
      async () =>
        (await nativeGroupsSync.migrate())
          ? { success: true, message: 'Migration completed' }
          : { success: false, message: 'Migration failed' },
    ],

    [
      'resetMigration',
      async () => {
        try {
          await migrationFlag.setComplete(false);
          return { success: true, message: 'Migration flag reset' };
        } catch (error) {
          return { success: false, message: messageOf(error) };
        }
      },
    ],

    [
      'setBackgroundState',
      (message) => {
        const opening = parseOpeningBackup(message);
        if (opening === undefined) {
          return Promise.resolve({
            error: 'Invalid setBackgroundState message',
          });
        }
        setOpeningBackup(opening);
        return Promise.resolve(undefined);
      },
    ],

    ['refreshView', () => viewRefresh.refreshView()],
    [
      'checkViewRefresh',
      () => Promise.resolve({ viewRefreshOrdered: viewRefresh.isOrdered() }),
    ],
    [
      'clearViewRefresh',
      () => {
        viewRefresh.clear();
        return Promise.resolve(undefined);
      },
    ],
  ]);

  return (raw) => {
    const envelope = openEnvelope(raw);
    const handler = envelope && handlers.get(envelope.action);

    if (envelope === undefined || handler === undefined) {
      logger.error('Unknown internal message action:', raw);
      return Promise.resolve({
        error: `Unknown action: ${String(envelope?.action)}`,
      });
    }
    return handler(envelope.message);
  };
}
