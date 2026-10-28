import type { Group, GroupState } from '../ports/group-state.js';
import type { I18n } from '../ports/i18n.js';
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
    heading: HTMLElement;
    groupsHeading: HTMLElement;
    status: HTMLElement;
    groups: HTMLElement;
    runButton: HTMLButtonElement;
    resetButton: HTMLElement;
  };
  // The page, for the title of its tab
  page: { title: string };
  migrationFlag: Pick<MigrationFlag, 'isComplete'>;
  groupState: Pick<GroupState, 'getGroups'>;
  windows: Pick<Windows, 'currentWindowId'>;
  messaging: Messaging;
  i18n: Pick<I18n, 'getMessage'>;
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
  {
    i18n,
    success,
    failure,
  }: {
    i18n: Pick<I18n, 'getMessage'>;
    success: string;
    failure: string;
  },
): string {
  if (isRecord(response) && response.success === true) {
    return i18n.getMessage(success);
  }
  const reason =
    isRecord(response) && isString(response.message)
      ? response.message
      : i18n.getMessage('migrationNoResponse');
  return i18n.getMessage(failure, [reason]);
}

function groupItem(
  { id, name, nativeGroupId }: Group,
  i18n: Pick<I18n, 'getMessage'>,
): HTMLElement {
  const { className, status } =
    typeof nativeGroupId === 'number'
      ? {
          className: 'migrated',
          status: i18n.getMessage('migrationGroupMigrated', [
            String(nativeGroupId),
          ]),
        }
      : {
          className: 'not-migrated',
          status: i18n.getMessage('migrationGroupNotMigrated'),
        };

  return newElement('div', { class: `group-item ${className}` }, [
    newElement('strong', {
      content: i18n.getMessage('migrationGroup', [String(id)]),
    }),
    document.createTextNode(` ${name}`),
    newElement('br', {}),
    newElement('small', {
      content: i18n.getMessage('migrationGroupStatus', [status]),
    }),
  ]);
}

/**
 * The page that shows whether the groups were moved to native tab groups, and
 * has buttons to do it again or to forget that it was done.
 */
export function createMigrationStatusPage({
  nodes,
  page,
  migrationFlag,
  groupState,
  windows,
  messaging,
  i18n,
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
        show('success', i18n.getMessage('migrationComplete'));
      } else {
        show('warning', i18n.getMessage('migrationPending'));
      }
    } catch (error) {
      show(
        'warning',
        i18n.getMessage('migrationStatusError', [messageOf(error)]),
      );
    }
  };

  const showGroups = async (): Promise<void> => {
    try {
      const groups =
        (await groupState.getGroups(await windows.currentWindowId())) ?? [];
      if (groups.length === 0) {
        nodes.groups.textContent = i18n.getMessage('migrationNoGroups');
        return;
      }
      nodes.groups.replaceChildren(
        ...groups.map((group) => groupItem(group, i18n)),
      );
    } catch (error) {
      nodes.groups.textContent = i18n.getMessage('migrationGroupsError', [
        messageOf(error),
      ]);
    }
  };

  const refresh = async (): Promise<void> => {
    await showStatus();
    await showGroups();
  };

  async function runMigration(): Promise<void> {
    nodes.runButton.disabled = true;
    nodes.runButton.textContent = i18n.getMessage('migrationRunning');
    try {
      alert(
        outcomeOf(await messaging.send({ action: 'migrateToHybridGroups' }), {
          i18n,
          success: 'migrationSucceeded',
          failure: 'migrationFailed',
        }),
      );
    } catch (error) {
      alert(i18n.getMessage('migrationRunError', [messageOf(error)]));
    } finally {
      nodes.runButton.disabled = false;
      nodes.runButton.textContent = i18n.getMessage('migrationRun');
      await refresh();
    }
  }

  async function resetMigration(): Promise<void> {
    if (!confirm(i18n.getMessage('migrationResetConfirm'))) {
      return;
    }
    try {
      alert(
        outcomeOf(await messaging.send({ action: 'resetMigration' }), {
          i18n,
          success: 'migrationResetSucceeded',
          failure: 'migrationResetFailed',
        }),
      );
    } catch (error) {
      alert(i18n.getMessage('migrationResetError', [messageOf(error)]));
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
      // What the page says before it knows anything, in the language of the browser
      page.title = i18n.getMessage('migrationTitle');
      nodes.heading.textContent = i18n.getMessage('migrationTitle');
      nodes.groupsHeading.textContent = i18n.getMessage(
        'migrationCurrentGroups',
      );
      nodes.status.textContent = i18n.getMessage('migrationChecking');
      nodes.groups.textContent = i18n.getMessage('migrationLoadingGroups');
      nodes.runButton.textContent = i18n.getMessage('migrationRun');
      nodes.resetButton.textContent = i18n.getMessage('migrationReset');

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
