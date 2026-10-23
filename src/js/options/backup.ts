import { createBrowserDownloads } from '../adapters/browser/downloads.js';
import { createBrowserMessaging } from '../adapters/browser/messaging.js';
import { createBrowserTabs } from '../adapters/browser/tabs.js';
import { createBrowserWindows } from '../adapters/browser/windows.js';
import { systemClock } from '../adapters/system/clock.js';
import { createBackupControls } from '../app/backup-controls.js';
import { createBackupService } from '../app/backup-service.js';
import { stateManager } from '../background/StateManager.js';
import { loadOptions } from '../share/options.js';

// A link the browser can download the text from
const objectUrlFor = (content: string): string =>
  URL.createObjectURL(new Blob([content], { type: 'application/json' }));

const controls = createBackupControls({
  service: createBackupService({
    windows: createBrowserWindows(() => browser),
    tabs: createBrowserTabs(() => browser),
    groupState: stateManager,
    messaging: createBrowserMessaging(() => browser),
    options: { load: loadOptions },
    downloads: createBrowserDownloads(() => browser, objectUrlFor),
    clock: systemClock,
    logger: console,
  }),
  notify: (message) => {
    window.alert(message);
  },
});

/** The file the user chose in the input that fired the event */
function chosenFileOf(event: Event): File | undefined {
  const { target } = event;
  return target instanceof HTMLInputElement
    ? (target.files?.item(0) ?? undefined)
    : undefined;
}

export const loadBackup = (event: Event): Promise<void> =>
  controls.openFile(chosenFileOf(event));

export const { save: saveBackup } = controls;
