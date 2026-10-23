import {
  backupFileName,
  groupsToOpen,
  type Backup,
  type BackupTab,
  type BackupWindow,
} from '../core/backup.js';
import type { Clock } from '../ports/clock.js';
import type { Downloads } from '../ports/downloads.js';
import type { Group, GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { Messaging } from '../ports/messaging.js';
import type { OptionsStore } from '../ports/options.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';

export interface BackupDeps {
  windows: Pick<Windows, 'listIds' | 'create' | 'place'>;
  tabs: Pick<Tabs, 'snapshotsInWindow' | 'listInWindow' | 'create' | 'close'>;
  groupState: Pick<
    GroupState,
    | 'getGroups'
    | 'getActiveGroup'
    | 'getGroupIndex'
    | 'getTabGroup'
    | 'setGroups'
    | 'setActiveGroup'
    | 'setGroupIndex'
    | 'setTabGroup'
  >;
  // To tell the background that the tabs about to be made are not new tabs
  messaging: Messaging;
  options: Pick<OptionsStore, 'load'>;
  downloads: Downloads;
  clock: Clock;
  logger: Pick<Logger, 'debug'>;
}

export interface BackupService {
  /** Offer the groups and tabs of every window as a file to save */
  save: () => Promise<void>;
  /** Open the windows of a backup, each in a new window; nothing is overwritten */
  open: (backup: Backup) => Promise<void>;
}

const VIEW_GROUP_ID = -1;

export function createBackupService({
  windows,
  tabs,
  groupState,
  messaging,
  options,
  downloads,
  clock,
  logger,
}: BackupDeps): BackupService {
  async function snapshotOf(windowId: number): Promise<BackupWindow> {
    const groups = (await groupState.getGroups(windowId)) ?? [];
    const snapshots = await tabs.snapshotsInWindow(windowId);
    const saved = await Promise.all(
      snapshots.map(async (snapshot): Promise<BackupTab[]> => {
        const groupId = await groupState.getTabGroup(snapshot.id);
        // The view is not a tab to keep, and a tab with no address cannot be opened
        return groupId === VIEW_GROUP_ID || snapshot.url === undefined
          ? []
          : [
              {
                url: snapshot.url,
                title: snapshot.title,
                groupId,
                index: snapshot.index,
                lastAccessed: snapshot.lastAccessed,
                pinned: snapshot.pinned,
              },
            ];
      }),
    );

    return {
      groups: groups.map(({ id, name, rect }) => ({ id, name, rect })),
      tabs: saved.flat(),
      activeGroup: await groupState.getActiveGroup(windowId),
      groupIndex: await groupState.getGroupIndex(windowId),
      position: undefined,
    };
  }

  async function openTab(windowId: number, tab: BackupTab): Promise<void> {
    try {
      const tabId = await tabs.create({
        url: tab.url,
        windowId,
        active: false,
        // A pinned tab is not allowed to be discarded
        discarded: !tab.pinned,
        pinned: tab.pinned,
      });
      if (tab.groupId !== undefined) {
        await groupState.setTabGroup(tabId, tab.groupId);
      }
    } catch (error) {
      // The rest of the tabs are still opened
      logger.debug(`Could not open ${tab.url}:`, error);
    }
  }

  // The new window starts with an empty tab, which is of no use once the view
  // or the tabs of the backup are there to be looked at
  async function finishWindow(windowId: number): Promise<void> {
    if ((await options.load()).view === 'freeform') {
      const viewTabId = await tabs.create({
        url: '/view.html',
        windowId,
        active: true,
        discarded: false,
        pinned: false,
      });
      await groupState.setTabGroup(viewTabId, VIEW_GROUP_ID);
      return;
    }

    const active = (await tabs.listInWindow(windowId)).filter(
      (tab) => tab.active,
    );
    const [only] = active;
    if (active.length === 1 && only !== undefined) {
      await tabs.close(only.id);
    }
  }

  async function openWindow(window: BackupWindow): Promise<void> {
    const groups: Group[] = groupsToOpen(window).map((group) => ({
      id: group.id,
      name: group.name,
      containerId: 'firefox-default',
      rect: group.rect,
      tabCount: 0,
    }));

    const windowId = await windows.create();
    if (window.position !== undefined) {
      await windows.place(windowId, window.position);
    }

    await groupState.setGroups(windowId, groups);
    if (window.activeGroup !== undefined) {
      await groupState.setActiveGroup(windowId, window.activeGroup);
    }
    if (window.groupIndex !== undefined) {
      await groupState.setGroupIndex(windowId, window.groupIndex);
    }

    await Promise.all(window.tabs.map((tab) => openTab(windowId, tab)));
    await finishWindow(windowId);
  }

  return {
    async save() {
      const windowIds = await windows.listIds();
      const backup: Backup = {
        file: { type: 'panoramaView', version: 1 },
        windows: await Promise.all(windowIds.map(snapshotOf)),
      };

      await downloads.saveFile(
        JSON.stringify(backup, null, '\t'),
        backupFileName(new Date(clock.now())),
      );
    },

    async open(backup) {
      const setOpening = (opening: boolean) =>
        messaging.send({
          action: 'setBackgroundState',
          key: 'openingBackup',
          value: opening,
        });

      await setOpening(true);
      try {
        await Promise.all(backup.windows.map(openWindow));
      } finally {
        // Or the background would take no notice of any new tab again
        await setOpening(false);
      }
    },
  };
}
