import { createAppearanceSettings } from '../adapters/browser/appearance-settings.js';
import { createBrowserDownloads } from '../adapters/browser/downloads.js';
import { createBrowserI18n } from '../adapters/browser/i18n.js';
import { createBrowserMessaging } from '../adapters/browser/messaging.js';
import { createBrowserOptions } from '../adapters/browser/options.js';
import { createBrowserShortcuts } from '../adapters/browser/shortcuts.js';
import { createBrowserTabs } from '../adapters/browser/tabs.js';
import { createBrowserViewState } from '../adapters/browser/view-state.js';
import { createBrowserViewTabs } from '../adapters/browser/view-tabs.js';
import { createBrowserWindows } from '../adapters/browser/windows.js';
import { systemClock } from '../adapters/system/clock.js';
import { createBackupControls } from '../app/backup-controls.js';
import { createBackupService } from '../app/backup-service.js';
import { stateManager } from '../background/StateManager.js';
import { applyLanguage } from '../share/direction.js';
import { detectCapabilities } from '../share/capabilities.js';
import { applyAppearance } from '../view/theme.js';
import { createBackupHandlers } from './backup.js';
import { createOptionsPage } from './page.js';

// A link the browser can download the text from
const objectUrlFor = (content: string): string =>
  URL.createObjectURL(new Blob([content], { type: 'application/json' }));

/** Show the options page, built out of the browser it runs in */
export async function startOptions(): Promise<void> {
  const i18n = createBrowserI18n(() => browser);
  applyLanguage(i18n, document.documentElement);

  // The theme first, so the page is not shown in the wrong colours while the rest is built
  await applyAppearance({
    body: document.body,
    systemPrefersDark: window.matchMedia('(prefers-color-scheme: dark)'),
    settings: createAppearanceSettings(() => browser),
  });

  const options = createBrowserOptions(() => browser);
  const messaging = createBrowserMessaging(() => browser);

  const backup = createBackupHandlers(
    createBackupControls({
      i18n,
      service: createBackupService({
        windows: createBrowserWindows(() => browser),
        tabs: createBrowserTabs(() => browser),
        groupState: stateManager,
        messaging,
        i18n,
        options,
        downloads: createBrowserDownloads(() => browser, objectUrlFor),
        clock: systemClock,
        logger: console,
      }),
      notify: (message) => {
        window.alert(message);
      },
    }),
  );

  await createOptionsPage({
    options,
    shortcuts: createBrowserShortcuts(() => browser),
    messaging,
    i18n,
    viewTabs: createBrowserViewTabs(() => browser),
    viewState: createBrowserViewState(() => browser),
    capabilities: detectCapabilities(browser),
    backup,
  }).start();
}
