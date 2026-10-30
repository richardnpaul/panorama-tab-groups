import { describe, expect, it, vi } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryDownloads } from '../../../src/js/adapters/memory/downloads.js';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createBackupService } from '../../../src/js/app/backup-service.js';
import {
  parseBackup,
  type Backup,
  type BackupWindow,
} from '../../../src/js/core/backup.js';
import type { Options } from '../../../src/js/core/options.js';
import { englishMessage } from '../../support/messages.js';

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

const optionsWith = (view: string): Options => ({
  toolbarPosition: 'top',
  useNativeGroups: true,
  shortcut: {},
  theme: 'auto',
  view,
});

function setUp(view = 'popup') {
  const windows = createMemoryWindows(1);
  const tabs = createMemoryTabs();
  const groupState = createMemoryGroupState();
  const messaging = createMemoryMessaging();
  const downloads = createMemoryDownloads();
  const logger = { debug: vi.fn() };
  const order: string[] = [];
  const send = messaging.send.bind(messaging);
  messaging.send = (message) => {
    order.push(`opening ${String(JSON.stringify(message).includes('true'))}`);
    return send(message);
  };
  return {
    service: createBackupService({
      windows,
      tabs,
      groupState,
      messaging,
      i18n: { getMessage: englishMessage },
      options: { load: () => Promise.resolve(optionsWith(view)) },
      downloads,
      clock: createMemoryClock(new Date(2026, 4, 6, 7, 8, 9).getTime()),
      logger,
    }),
    windows,
    tabs,
    groupState,
    messaging,
    downloads,
    logger,
    order,
  };
}

const backupWindow = (overrides: Partial<BackupWindow> = {}): BackupWindow => ({
  groups: [{ id: 1, name: 'Work', rect }],
  tabs: [],
  activeGroup: 1,
  groupIndex: 2,
  position: undefined,
  ...overrides,
});

const backupOf = (...windows: BackupWindow[]): Backup => ({
  file: { type: 'tgvView', version: 1 },
  windows,
});

const tab = (url: string, overrides: Record<string, unknown> = {}) => ({
  url,
  title: undefined,
  groupId: 1,
  index: undefined,
  lastAccessed: undefined,
  pinned: false,
  ...overrides,
});

const detail = (id: number, windowId: number, overrides = {}) => ({
  id,
  windowId,
  active: false,
  pinned: false,
  url: `https://site${String(id)}/`,
  pendingUrl: undefined,
  title: `T${String(id)}`,
  browserGroupId: undefined,
  ...overrides,
});

describe('app/backup-service.ts', () => {
  describe('save', () => {
    it('offers the groups and tabs of every window as a file named for the time', async () => {
      const env = setUp();
      env.windows.open(2);
      await env.groupState.setGroups(1, [
        { id: 1, name: 'Work', containerId: 'c', rect, nativeGroupId: 5 },
      ]);
      await env.groupState.setActiveGroup(1, 1);
      await env.groupState.setGroupIndex(1, 2);
      await env.groupState.setGroups(2, [
        { id: 3, name: 'Play', containerId: 'c', rect },
      ]);
      env.tabs.setDetails([
        detail(10, 1, { pinned: true }),
        detail(11, 1),
        detail(20, 2),
      ]);
      env.tabs.setLastAccessed({ 10: 100 });
      await env.groupState.setTabGroup(10, 1);
      await env.groupState.setTabGroup(11, 1);
      await env.groupState.setTabGroup(20, 3);

      await env.service.save();

      expect(env.downloads.saved).toHaveLength(1);
      expect(env.downloads.saved[0]?.filename).toBe(
        'tgvView-backup-260506-070809.json',
      );
      expect(JSON.parse(env.downloads.saved[0]?.content ?? '')).toEqual({
        file: { type: 'tgvView', version: 1 },
        windows: [
          {
            groups: [{ id: 1, name: 'Work', rect }],
            tabs: [
              {
                url: 'https://site10/',
                title: 'T10',
                groupId: 1,
                index: 0,
                lastAccessed: 100,
                pinned: true,
              },
              {
                url: 'https://site11/',
                title: 'T11',
                groupId: 1,
                index: 1,
                lastAccessed: 0,
                pinned: false,
              },
            ],
            activeGroup: 1,
            groupIndex: 2,
          },
          {
            groups: [{ id: 3, name: 'Play', rect }],
            tabs: [
              {
                url: 'https://site20/',
                title: 'T20',
                groupId: 3,
                index: 0,
                lastAccessed: 0,
                pinned: false,
              },
            ],
          },
        ],
      });
    });

    it('is indented with tabs', async () => {
      const env = setUp();

      await env.service.save();

      expect(env.downloads.saved[0]?.content).toContain('\n\t');
    });

    it('does not keep the view, or a tab with no address', async () => {
      const env = setUp();
      env.tabs.setDetails([
        detail(10, 1, { url: '/view.html' }),
        detail(11, 1, { url: undefined }),
        detail(12, 1),
      ]);
      await env.groupState.setTabGroup(10, -1);
      await env.groupState.setTabGroup(11, 1);
      await env.groupState.setTabGroup(12, 1);

      await env.service.save();

      const saved = parseBackup(env.downloads.saved[0]?.content ?? '');
      expect(saved?.windows[0]?.tabs.map((each) => each.url)).toEqual([
        'https://site12/',
      ]);
    });

    it('keeps a tab that has no group, without one', async () => {
      const env = setUp();
      env.tabs.setDetails([detail(10, 1)]);

      await env.service.save();

      expect(env.downloads.saved[0]?.content).not.toContain('groupId');
      const saved = parseBackup(env.downloads.saved[0]?.content ?? '');
      expect(saved?.windows[0]?.tabs).toHaveLength(1);
    });

    it('keeps the tabs in group 0', async () => {
      const env = setUp();
      env.tabs.setDetails([detail(10, 1)]);
      await env.groupState.setTabGroup(10, 0);

      await env.service.save();

      const saved = parseBackup(env.downloads.saved[0]?.content ?? '');
      expect(saved?.windows[0]?.tabs[0]?.groupId).toBe(0);
    });

    it('saves a window that has no groups stored as one with none', async () => {
      const env = setUp();

      await env.service.save();

      const saved: unknown = JSON.parse(env.downloads.saved[0]?.content ?? '');
      expect(saved).toEqual({
        file: { type: 'tgvView', version: 1 },
        windows: [{ groups: [], tabs: [] }],
      });
    });

    it('passes on a failure to offer the file', async () => {
      const env = setUp();
      const failure = new Error('cancelled');
      env.downloads.saveFile = () => Promise.reject(failure);

      await expect(env.service.save()).rejects.toBe(failure);
    });
  });

  describe('open', () => {
    it('makes a window for each window of the backup, with its groups and where it was', async () => {
      const env = setUp();
      const first = backupWindow({
        position: { left: 5, top: 6, width: 700, height: 500 },
      });
      const second = backupWindow({
        groups: [{ id: 4, name: 'Other', rect }],
        activeGroup: 4,
        groupIndex: 9,
      });

      await env.service.open(backupOf(first, second));

      const ids = await env.windows.listIds();
      expect(ids).toEqual([1, 100, 101]);
      expect(env.windows.placements.get(100)).toEqual({
        left: 5,
        top: 6,
        width: 700,
        height: 500,
      });
      expect(env.windows.placements.has(101)).toBe(false);
      expect(await env.groupState.getGroups(100)).toEqual([
        {
          id: 1,
          name: 'Work',
          containerId: 'firefox-default',
          rect,
          tabCount: 0,
        },
      ]);
      expect(await env.groupState.getActiveGroup(100)).toBe(1);
      expect(await env.groupState.getGroupIndex(100)).toBe(2);
      expect(await env.groupState.getActiveGroup(101)).toBe(4);
      expect(await env.groupState.getGroupIndex(101)).toBe(9);
    });

    it('does not store an active group or group index the window did not have', async () => {
      const env = setUp();

      await env.service.open(
        backupOf(
          backupWindow({ activeGroup: undefined, groupIndex: undefined }),
        ),
      );

      expect(await env.groupState.getActiveGroup(100)).toBeUndefined();
      expect(await env.groupState.getGroupIndex(100)).toBeUndefined();
    });

    it('stores the active group 0 and the group index 0', async () => {
      const env = setUp();

      await env.service.open(
        backupOf(backupWindow({ activeGroup: 0, groupIndex: 0 })),
      );

      expect(await env.groupState.getActiveGroup(100)).toBe(0);
      expect(await env.groupState.getGroupIndex(100)).toBe(0);
    });

    it('makes groups for the groups the tabs were in when the window has none', async () => {
      const env = setUp();

      await env.service.open(
        backupOf(
          backupWindow({
            groups: [],
            tabs: [tab('https://a/', { groupId: 7 })],
          }),
        ),
      );

      expect((await env.groupState.getGroups(100))?.map((g) => g.name)).toEqual(
        ['Grp7'],
      );
    });

    it('opens the tabs in the window, in the group they were in, discarded unless pinned', async () => {
      const env = setUp();

      await env.service.open(
        backupOf(
          backupWindow({
            tabs: [
              tab('https://a/', { groupId: 1 }),
              tab('https://p/', { groupId: 0, pinned: true }),
            ],
          }),
        ),
      );

      expect(env.tabs.calls).toEqual(
        expect.arrayContaining([
          'create https://a/ in 100 discarded',
          'create https://p/ in 100 pinned',
        ]),
      );
      const listed = await env.tabs.listInWindow(100);
      const groupOf = async (url: string) =>
        env.groupState.getTabGroup(
          listed.find((each) => each.url === url)?.id ?? -99,
        );
      expect(await groupOf('https://a/')).toBe(1);
      expect(await groupOf('https://p/')).toBe(0);
    });

    it('opens a tab that was in no group without giving it one', async () => {
      const env = setUp();

      await env.service.open(
        backupOf(
          backupWindow({ tabs: [tab('https://a/', { groupId: undefined })] }),
        ),
      );

      const [opened] = await env.tabs.listInWindow(100);
      expect(
        await env.groupState.getTabGroup(opened?.id ?? -99),
      ).toBeUndefined();
    });

    it('carries on with the other tabs when one cannot be opened, and says so', async () => {
      const env = setUp();
      const failure = new Error('invalid url');
      env.tabs.refuseNextCreate(failure);

      await env.service.open(
        backupOf(
          backupWindow({
            tabs: [tab('https://bad/'), tab('https://good/')],
          }),
        ),
      );

      expect(
        (await env.tabs.listInWindow(100)).map((each) => each.url),
      ).toEqual(['https://good/']);
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Could not open https://bad/:',
        failure,
      );
    });

    it('tells the background a backup is being opened, until it has been', async () => {
      const env = setUp();

      await env.service.open(backupOf(backupWindow()));

      expect(env.messaging.sent).toEqual([
        { action: 'setBackgroundState', key: 'openingBackup', value: true },
        { action: 'setBackgroundState', key: 'openingBackup', value: false },
      ]);
    });

    it('tells it before it does anything, and after the last window', async () => {
      const env = setUp();
      const create = env.windows.create.bind(env.windows);
      env.windows.create = () => {
        env.order.push('window');
        return create();
      };

      await env.service.open(backupOf(backupWindow(), backupWindow()));

      expect(env.order).toEqual([
        'opening true',
        'window',
        'window',
        'opening false',
      ]);
    });

    it('tells the background it is over even when opening failed, and passes the failure on', async () => {
      const env = setUp();
      const failure = new Error('no windows');
      env.windows.create = () => Promise.reject(failure);

      await expect(env.service.open(backupOf(backupWindow()))).rejects.toBe(
        failure,
      );

      expect(env.messaging.sent.at(-1)).toEqual({
        action: 'setBackgroundState',
        key: 'openingBackup',
        value: false,
      });
    });

    describe('in the freeform view', () => {
      it('opens the view in the window and gives it the view group', async () => {
        const env = setUp('freeform');

        await env.service.open(backupOf(backupWindow()));

        const tabs = await env.tabs.listInWindow(100);
        const view = tabs.find((each) => each.url === '/view.html');
        expect(view?.active).toBe(true);
        expect(await env.groupState.getTabGroup(view?.id ?? -99)).toBe(-1);
        expect(env.tabs.calls).toEqual(['create /view.html in 100 active']);
      });
    });

    describe('in another view', () => {
      it('closes the one tab that is active in the window', async () => {
        const env = setUp('popup');
        const create = env.windows.create.bind(env.windows);
        env.windows.create = async () => {
          const id = await create();
          env.tabs.setDetails([detail(77, id, { active: true })]);
          return id;
        };

        await env.service.open(backupOf(backupWindow()));

        expect(env.tabs.calls).toContain('close 77');
      });

      it('does not close anything when no tab, or more than one, is active', async () => {
        const env = setUp('popup');

        await env.service.open(backupOf(backupWindow()));

        expect(
          env.tabs.calls.filter((call) => call.startsWith('close')),
        ).toEqual([]);

        const another = setUp('popup');
        const create = another.windows.create.bind(another.windows);
        another.windows.create = async () => {
          const id = await create();
          another.tabs.setDetails([
            detail(1, id, { active: true }),
            detail(2, id, { active: true }),
          ]);
          return id;
        };

        await another.service.open(backupOf(backupWindow()));

        expect(
          another.tabs.calls.filter((call) => call.startsWith('close')),
        ).toEqual([]);
      });

      it('does not open the view', async () => {
        const env = setUp('popup');

        await env.service.open(backupOf(backupWindow()));

        expect(env.tabs.calls).toEqual([]);
      });
    });
  });
});
