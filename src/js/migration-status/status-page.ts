import type { Group, GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Messaging } from '../ports/messaging.js';
import type { MigrationFlag } from '../ports/migration-flag.js';
import type { Scheduler } from '../ports/scheduler.js';
import type { Windows } from '../ports/windows.js';
import { isRecord, isString, messageOf } from '../share/guards.js';
import { newElement } from '../share/utils.js';

/** How often what the page shows is looked at again */
export const REFRESH_MS = 5000;

export interface MigrationStatusDeps {
  nodes: {
    status: HTMLElement;
    groups: HTMLElement;
    runButton: HTMLButtonElement;
    resetButton: HTMLElement;
  };
  migrationFlag: Pick<MigrationFlag, 'isComplete'>;
  groupState: Pick<GroupState, 'getGroups'>;
  windows: Pick<Windows, 'currentWindowId'>;
  messaging: Messaging;
  scheduler: Pick<Scheduler, 'setTimeout'>;
  alert: (message: string) => void;
  confirm: (message: string) => boolean;
  logger: Pick<Logger, 'error'>;
}

export interface MigrationStatusPage {
  /** Show the status and the groups, and keep them up to date */
  start(): Promise<void>;
}

/** What the background answered, as a sentence for the user */
function outcomeOf(
  response: unknown,
  success: string,
  failure: string,
): string {
  if (isRecord(response) && response.success === true) {
    return success;
  }
  const reason =
    isRecord(response) && isString(response.message)
      ? response.message
      : 'No response';
  return `${failure}: ${reason}`;
}

function groupItem({ id, name, nativeGroupId }: Group): HTMLElement {
  const { className, status } =
    typeof nativeGroupId === 'number'
      ? {
          className: 'migrated',
          status: `✓ Migrated (Native ID: ${String(nativeGroupId)})`,
        }
      : { className: 'not-migrated', status: '✗ Not Migrated' };

  return newElement('div', { class: `group-item ${className}` }, [
    newElement('strong', { content: `Group ${String(id)}:` }),
    document.createTextNode(` ${name}`),
    newElement('br', {}),
    newElement('small', { content: `Status: ${status}` }),
  ]);
}

/**
 * The page that shows whether the groups were moved to native tab groups, and
 * has buttons to do it again or to forget that it was done.
 */
export function createMigrationStatusPage({
  nodes,
  migrationFlag,
  groupState,
  windows,
  messaging,
  scheduler,
  alert,
  confirm,
  logger,
}: MigrationStatusDeps): MigrationStatusPage {
  const report = (action: Promise<unknown>): void => {
    action.catch((error: unknown) => {
      logger.error('[Migration] An action failed:', error);
    });
  };

  const showStatus = async (): Promise<void> => {
    const show = (className: string, text: string): void => {
      nodes.status.className = `status-box ${className}`;
      nodes.status.textContent = text;
    };
    try {
      if (await migrationFlag.isComplete()) {
        show(
          'success',
          '✓ Migration Complete - All groups have been migrated to hybrid system',
        );
      } else {
        show(
          'warning',
          '⚠ Migration Pending - Groups have not been migrated yet',
        );
      }
    } catch (error) {
      show('warning', `Error checking migration status: ${messageOf(error)}`);
    }
  };

  const showGroups = async (): Promise<void> => {
    try {
      const groups =
        (await groupState.getGroups(await windows.currentWindowId())) ?? [];
      if (groups.length === 0) {
        nodes.groups.textContent = 'No groups found in current window';
        return;
      }
      nodes.groups.replaceChildren(...groups.map(groupItem));
    } catch (error) {
      nodes.groups.textContent = `Error loading groups: ${messageOf(error)}`;
    }
  };

  const refresh = async (): Promise<void> => {
    await showStatus();
    await showGroups();
  };

  async function runMigration(): Promise<void> {
    nodes.runButton.disabled = true;
    nodes.runButton.textContent = 'Running migration...';
    try {
      alert(
        outcomeOf(
          await messaging.send({ action: 'migrateToHybridGroups' }),
          'Migration completed successfully!',
          'Migration failed',
        ),
      );
    } catch (error) {
      alert(`Migration error: ${messageOf(error)}`);
    } finally {
      nodes.runButton.disabled = false;
      nodes.runButton.textContent = 'Run Migration Now';
      await refresh();
    }
  }

  async function resetMigration(): Promise<void> {
    if (
      !confirm('Reset migration flag? This will allow migration to run again.')
    ) {
      return;
    }
    try {
      alert(
        outcomeOf(
          await messaging.send({ action: 'resetMigration' }),
          'Migration flag reset successfully!',
          'Reset failed',
        ),
      );
    } catch (error) {
      alert(`Reset error: ${messageOf(error)}`);
    }
    await showStatus();
  }

  // The next look comes after the last one is done, so they do not overlap
  const scheduleRefresh = (): void => {
    scheduler.setTimeout(() => {
      report(refresh().then(scheduleRefresh));
    }, REFRESH_MS);
  };

  return {
    async start() {
      nodes.runButton.addEventListener('click', () => {
        report(runMigration());
      });
      nodes.resetButton.addEventListener('click', () => {
        report(resetMigration());
      });
      await refresh();
      scheduleRefresh();
    },
  };
}
