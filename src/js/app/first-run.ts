import type { Extension } from '../ports/extension.js';
import type { I18n } from '../ports/i18n.js';
import type { Logger } from '../ports/logger.js';
import type { Notifications } from '../ports/notifications.js';
import type { OptionsStore } from '../ports/options.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { Capabilities } from '../share/capabilities.js';

const NOTICE_ID = 'first-run-native-groups-off';

export interface FirstRunDeps {
  options: Pick<OptionsStore, 'isSet' | 'save'>;
  windows: Pick<Windows, 'listIds'>;
  tabs: Pick<Tabs, 'hiddenIdsInWindow'>;
  capabilities: Capabilities;
  notifications: Pick<Notifications, 'show' | 'clear'>;
  extension: Pick<Extension, 'urlOf' | 'openOptionsPage'>;
  i18n: Pick<I18n, 'getMessage'>;
  logger: Pick<Logger, 'debug' | 'warn'>;
}

export interface FirstRun {
  /**
   * The first time the add-on runs, and no choice about native tab groups was made
   * yet, decide it once: off where a window has hidden tabs, which are groups that
   * hide their tabs (another add-on's, or this one's from before), and on otherwise.
   * Turning native groups on there would show every hidden tab and make their groups
   * native ones, which nobody asked for. It is stored, so it is not decided again.
   * Where it is off, the user is told once, and where the options are that turn it
   * on and import the groups of another add-on.
   */
  decideNativeGroups: () => Promise<void>;
  /** The user clicked a notification: the notice leads to the options */
  noticeClicked: (id: string) => Promise<void>;
}

export function createFirstRun({
  options,
  windows,
  tabs,
  capabilities,
  notifications,
  extension,
  i18n,
  logger,
}: FirstRunDeps): FirstRun {
  // Native groups in a window change nothing: with no hidden tab, they are on either way
  async function hasHiddenTabs(): Promise<boolean> {
    const hidden = await Promise.all(
      (await windows.listIds()).map(
        async (windowId) => (await tabs.hiddenIdsInWindow(windowId)).length > 0,
      ),
    );
    return hidden.includes(true);
  }

  // Never worth failing the start-up over: the browser may refuse notifications
  async function tellTabsWereKept(): Promise<void> {
    try {
      await notifications.show(NOTICE_ID, {
        title: i18n.getMessage('extensionName'),
        message: i18n.getMessage('firstRunNativeGroupsOff'),
        iconUrl: extension.urlOf('icons/logo/logo-128.png'),
      });
    } catch (error) {
      logger.warn('[FirstRun] The notice could not be shown:', error);
    }
  }

  return {
    async decideNativeGroups() {
      // Where tabs cannot also be hidden, native groups are the only kind, and not a choice
      if (!capabilities.hasTabGroups || !capabilities.hasTabHide) {
        return;
      }
      if (await options.isSet('useNativeGroups')) {
        return;
      }

      const keep = await hasHiddenTabs();
      await options.save({ useNativeGroups: !keep });
      logger.debug(
        keep
          ? '[FirstRun] Tabs are hidden in groups: native tab groups stay off until the user turns them on'
          : '[FirstRun] No tab is hidden: native tab groups are on',
      );
      if (keep) {
        await tellTabsWereKept();
      }
    },

    async noticeClicked(id) {
      if (id !== NOTICE_ID) {
        return;
      }
      await notifications.clear(NOTICE_ID).catch(() => undefined);
      await extension.openOptionsPage();
    },
  };
}
