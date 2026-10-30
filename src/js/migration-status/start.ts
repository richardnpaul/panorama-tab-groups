import { createBrowserI18n } from '../adapters/browser/i18n.js';
import { createBrowserMessaging } from '../adapters/browser/messaging.js';
import { createBrowserMigrationFlag } from '../adapters/browser/migration-flag.js';
import { createBrowserWindows } from '../adapters/browser/windows.js';
import { createSystemScheduler } from '../adapters/system/scheduler.js';
import { stateManager } from '../background/StateManager.js';
import { applyLanguage } from '../share/direction.js';
import { requireElementById } from '../share/dom.js';
import { createMigrationStatusPage } from './status-page.js';

/** Show the status of the migration to native tab groups */
export async function startMigrationStatus(): Promise<void> {
  const i18n = createBrowserI18n(() => browser);
  applyLanguage(i18n, document.documentElement);
  await createMigrationStatusPage({
    page: document,
    nodes: {
      heading: requireElementById(HTMLElement, 'migration-title'),
      groupsHeading: requireElementById(HTMLElement, 'groups-title'),
      status: requireElementById(HTMLElement, 'migration-status'),
      groups: requireElementById(HTMLElement, 'groups-container'),
      runButton: requireElementById(HTMLButtonElement, 'run-migration'),
      resetButton: requireElementById(HTMLElement, 'reset-migration'),
    },
    migrationFlag: createBrowserMigrationFlag(() => browser),
    groupState: stateManager,
    windows: createBrowserWindows(() => browser),
    messaging: createBrowserMessaging(() => browser),
    i18n,
    scheduler: createSystemScheduler(),
    alert: (message) => {
      window.alert(message);
    },
    confirm: (message) => window.confirm(message),
    logger: console,
  }).start();
}
