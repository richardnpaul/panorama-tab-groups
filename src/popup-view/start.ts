import { applyLanguage } from '../js/share/direction.js';
import { createAppearanceSettings } from '../js/adapters/browser/appearance-settings.js';
import { createBrowserExtension } from '../js/adapters/browser/extension.js';
import { createBrowserI18n } from '../js/adapters/browser/i18n.js';
import { createBrowserMessaging } from '../js/adapters/browser/messaging.js';
import { createBrowserTabs } from '../js/adapters/browser/tabs.js';
import { createBrowserViewTabs } from '../js/adapters/browser/view-tabs.js';
import { createBrowserWindows } from '../js/adapters/browser/windows.js';
import { systemClock } from '../js/adapters/system/clock.js';
import { createSystemScheduler } from '../js/adapters/system/scheduler.js';
import { createGroupsStore } from '../js/app/groups-store.js';
import { createPopupService } from '../js/app/popup-service.js';
import { stateManager } from '../js/background/StateManager.js';
import { requireElementById } from '../js/share/dom.js';
import { createLate } from '../js/view/late.js';
import { applyAppearance } from '../js/view/theme.js';
import { createDetailFrame, type DetailFrame } from './detail-frame.js';
import { createFrame } from './frame.js';
import { createGroupsFrame, type GroupsFrame } from './groups-frame.js';
import { createTabList } from './tab-list.js';

/**
 * Show the popup of the toolbar button: the groups of the window to go to, and
 * the tabs of each group.
 */
export async function startPopup(): Promise<void> {
  const i18n = createBrowserI18n(() => browser);
  applyLanguage(i18n, document.documentElement);
  await applyAppearance({
    body: document.body,
    systemPrefersDark: window.matchMedia('(prefers-color-scheme: dark)'),
    settings: createAppearanceSettings(() => browser),
  });

  const logger = console;
  const viewTabs = createBrowserViewTabs(() => browser);
  const windowId = await createBrowserWindows(() => browser).currentWindowId();

  const groups = await createGroupsStore(
    {
      groupState: stateManager,
      messaging: createBrowserMessaging(() => browser),
      tabs: createBrowserTabs(() => browser),
      clock: systemClock,
      i18n,
      logger,
    },
    windowId,
  );
  const service = createPopupService({
    groups,
    groupState: stateManager,
    tabs: viewTabs,
  });

  const closePopup = (): void => {
    window.close();
  };
  const openTab = async (tab: { id: number }): Promise<void> => {
    await service.openTab(tab.id);
    closePopup();
  };

  // The two frames show each other
  const groupsLate = createLate<GroupsFrame>();
  const detailLate = createLate<DetailFrame>();
  const report = (action: Promise<unknown>): void => {
    action.catch((error: unknown) => {
      logger.error('[Popup] A frame failed:', error);
    });
  };
  const back = (): void => {
    report(groupsLate.get().render());
  };

  const shell = requireElementById(HTMLElement, 'frame-shell');
  const scheduler = createSystemScheduler();
  const tabList = createTabList({
    i18n,
    logger,
    open: openTab,
    close: (tab) => service.closeTab(tab.id),
  });

  groupsLate.bind(
    createGroupsFrame({
      frame: createFrame({
        node: requireElementById(HTMLElement, 'main-frame'),
        shell,
        body: document.body,
        scheduler,
        isAside: false,
      }),
      service,
      tabList,
      i18n,
      logger,
      extension: createBrowserExtension(() => browser),
      openTab,
      closePopup,
      confirm: (message) => window.confirm(message),
      openDetail: (groupId, isNew) => {
        report(detailLate.get().render(groupId, isNew));
      },
    }),
  );
  detailLate.bind(
    createDetailFrame({
      frame: createFrame({
        node: requireElementById(HTMLElement, 'aside-frame'),
        shell,
        body: document.body,
        scheduler,
        isAside: true,
        onLeftAtStart: back,
      }),
      service,
      tabList,
      i18n,
      logger,
      closePopup,
      back,
    }),
  );

  await groupsLate.get().render();
}
