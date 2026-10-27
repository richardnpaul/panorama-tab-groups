import { describe, expect, it } from 'vitest';
import {
  backupFileName,
  groupsToOpen,
  parseBackup,
  type BackupWindow,
} from '../../../src/js/core/backup.js';

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

const ours = (windows: unknown[]) =>
  JSON.stringify({ file: { type: 'tgvView', version: 1 }, windows });

const window = (overrides: Record<string, unknown> = {}) => ({
  groups: [{ id: 1, name: 'Work', rect }],
  tabs: [
    {
      url: 'https://a/',
      title: 'A',
      groupId: 1,
      index: 0,
      lastAccessed: 99,
      pinned: false,
    },
  ],
  activeGroup: 1,
  groupIndex: 2,
  position: { left: 10, top: 20, width: 800, height: 600 },
  ...overrides,
});

describe('core/backup.ts', () => {
  describe('parseBackup of a backup of this extension', () => {
    it('gives the windows with their groups, tabs, and where they were', () => {
      expect(parseBackup(ours([window()]))).toEqual({
        file: { type: 'tgvView', version: 1 },
        windows: [
          {
            groups: [{ id: 1, name: 'Work', rect }],
            tabs: [
              {
                url: 'https://a/',
                title: 'A',
                groupId: 1,
                index: 0,
                lastAccessed: 99,
                pinned: false,
              },
            ],
            activeGroup: 1,
            groupIndex: 2,
            position: { left: 10, top: 20, width: 800, height: 600 },
          },
        ],
      });
    });

    it('leaves out what it does not know of', () => {
      const parsed = parseBackup(
        ours([
          window({
            extra: true,
            groups: [{ id: 1, name: 'W', rect, extra: 1 }],
            tabs: [{ url: 'https://a/', extra: 1 }],
          }),
        ]),
      );

      expect(parsed?.windows[0]?.groups[0]).toStrictEqual({
        id: 1,
        name: 'W',
        rect,
      });
      expect(parsed?.windows[0]?.tabs[0]).toStrictEqual({
        url: 'https://a/',
        title: undefined,
        groupId: undefined,
        index: undefined,
        lastAccessed: undefined,
        pinned: false,
      });
    });

    it('has no windows for a backup of none', () => {
      expect(parseBackup(ours([]))?.windows).toEqual([]);
    });

    it('keeps the order of the windows', () => {
      const parsed = parseBackup(
        ours([window({ activeGroup: 1 }), window({ activeGroup: 2 })]),
      );

      expect(parsed?.windows.map((each) => each.activeGroup)).toEqual([1, 2]);
    });

    it.each([
      ['no active group', { activeGroup: undefined }],
      ['no group index', { groupIndex: 'x' }],
    ])('copes with %s', (_name, overrides) => {
      const parsed = parseBackup(ours([window(overrides)]));

      expect(parsed?.windows).toHaveLength(1);
    });

    it('has no active group and no group index when they are not numbers', () => {
      const parsed = parseBackup(
        ours([window({ activeGroup: 'a', groupIndex: null })]),
      );

      expect(parsed?.windows[0]?.activeGroup).toBeUndefined();
      expect(parsed?.windows[0]?.groupIndex).toBeUndefined();
    });

    it('has no position when the window has none, and only the numbers it has', () => {
      expect(
        parseBackup(ours([window({ position: undefined })]))?.windows[0]
          ?.position,
      ).toBeUndefined();
      expect(
        parseBackup(ours([window({ position: { left: 5, top: 'x' } })]))
          ?.windows[0]?.position,
      ).toStrictEqual({ left: 5 });
    });

    it('takes the last numbers of a position too', () => {
      expect(
        parseBackup(ours([window({ position: { width: 1, height: 2 } })]))
          ?.windows[0]?.position,
      ).toStrictEqual({ width: 1, height: 2 });
    });

    it('drops a window that is not one, or has no groups and tabs lists', () => {
      const parsed = parseBackup(
        ours([
          window(),
          'window',
          null,
          window({ groups: 'no' }),
          window({ tabs: {} }),
        ]),
      );

      expect(parsed?.windows).toHaveLength(1);
    });

    it('drops a group that is not complete', () => {
      const parsed = parseBackup(
        ours([
          window({
            groups: [
              { id: 1, name: 'Ok', rect },
              { id: 1.5, name: 'Fraction', rect },
              { id: '2', name: 'Text id', rect },
              { id: 3, name: 7, rect },
              { id: 4, name: 'No rect' },
              { id: 5, name: 'Bad rect', rect: { x: 0, y: 0, w: 'a', h: 1 } },
              { id: 6, name: 'Rect without x', rect: { y: 0, w: 1, h: 1 } },
              { id: 7, name: 'Rect without y', rect: { x: 0, w: 1, h: 1 } },
              { id: 8, name: 'Rect without w', rect: { x: 0, y: 0, h: 1 } },
              { id: 9, name: 'Rect without h', rect: { x: 0, y: 0, w: 1 } },
              'group',
              null,
              [],
            ],
          }),
        ]),
      );

      expect(parsed?.windows[0]?.groups.map((group) => group.id)).toEqual([1]);
    });

    it('keeps the group 0, which is numbered 0', () => {
      const parsed = parseBackup(
        ours([window({ groups: [{ id: 0, name: 'First', rect }] })]),
      );

      expect(parsed?.windows[0]?.groups).toHaveLength(1);
    });

    it('drops a tab that has no address', () => {
      const parsed = parseBackup(
        ours([
          window({
            tabs: [
              { url: 'https://a/' },
              { title: 'No address' },
              { url: 5 },
              'tab',
              null,
            ],
          }),
        ]),
      );

      expect(parsed?.windows[0]?.tabs.map((tab) => tab.url)).toEqual([
        'https://a/',
      ]);
    });

    it('has a tab with no group when its group is not a whole number', () => {
      const parsed = parseBackup(
        ours([
          window({
            tabs: [
              { url: 'a', groupId: 1.5 },
              { url: 'b', groupId: '2' },
              { url: 'c', groupId: 0 },
              { url: 'd', groupId: -1 },
            ],
          }),
        ]),
      );

      expect(parsed?.windows[0]?.tabs.map((tab) => tab.groupId)).toEqual([
        undefined,
        undefined,
        0,
        -1,
      ]);
    });

    it('has a tab pinned only when it says it is', () => {
      const parsed = parseBackup(
        ours([
          window({
            tabs: [
              { url: 'a', pinned: true },
              { url: 'b', pinned: 'yes' },
              { url: 'c' },
            ],
          }),
        ]),
      );

      expect(parsed?.windows[0]?.tabs.map((tab) => tab.pinned)).toEqual([
        true,
        false,
        false,
      ]);
    });

    it('has a title, index and time only when they are text and numbers', () => {
      const parsed = parseBackup(
        ours([
          window({
            tabs: [{ url: 'a', title: 3, index: 'x', lastAccessed: null }],
          }),
        ]),
      );

      expect(parsed?.windows[0]?.tabs[0]).toStrictEqual({
        url: 'a',
        title: undefined,
        groupId: undefined,
        index: undefined,
        lastAccessed: undefined,
        pinned: false,
      });
    });

    it.each([
      ['no windows', JSON.stringify({ file: { type: 'tgvView', version: 1 } })],
      [
        'windows that are not a list',
        JSON.stringify({
          file: { type: 'tgvView', version: 1 },
          windows: {},
        }),
      ],
    ])('is nothing for a file with %s', (_name, text) => {
      expect(parseBackup(text)).toBeUndefined();
    });

    it('reads a backup made before the rename and gives it the name it has now', () => {
      const text = ours([window({})]).replace('tgvView', 'panoramaView');

      expect(parseBackup(text)).toStrictEqual(parseBackup(ours([window({})])));
      expect(parseBackup(text)?.file).toStrictEqual({
        type: 'tgvView',
        version: 1,
      });
    });

    it('reads a backup of the earlier type only at the version it was written at', () => {
      const text = ours([window({})])
        .replace('tgvView', 'panoramaView')
        .replace('"version":1', '"version":2');

      expect(text).toContain('"version":2');
      expect(parseBackup(text)).toBeUndefined();
    });

    it.each([
      ['another type', { type: 'other', version: 1 }],
      ['another version', { type: 'tgvView', version: 2 }],
      ['no version', { type: 'tgvView' }],
    ])('is nothing for a file of %s', (_name, file) => {
      expect(
        parseBackup(JSON.stringify({ file, windows: [] })),
      ).toBeUndefined();
    });
  });

  describe('parseBackup of what is not a backup', () => {
    it.each([
      ['not JSON', 'nope'],
      ['empty', ''],
      ['null', 'null'],
      ['a number', '5'],
      ['text', '"text"'],
      ['a list', '[]'],
      ['an object with nothing', '{}'],
      ['a file that is not a record', JSON.stringify({ file: 'x' })],
    ])('is nothing for %s', (_name, text) => {
      expect(parseBackup(text)).toBeUndefined();
    });

    it.each([
      ['another add-on', ['other', 1]],
      ['another version', ['tabGroups', 2]],
      ['no version number', ['tabGroups']],
      ['not a list', 'tabGroups'],
      ['a name that is not text', [1, 1]],
    ])('is nothing for a version of %s', (_name, version) => {
      expect(parseBackup(JSON.stringify({ version, windows: [] }))).toBe(
        undefined,
      );
    });
  });

  describe('parseBackup of a backup of Tab Groups', () => {
    const oldWindow = (overrides: Record<string, unknown> = {}) => ({
      screenX: 5,
      screenY: 6,
      width: 800,
      height: 600,
      extData: {
        'tabview-group': JSON.stringify([
          { id: 1, title: 'One' },
          { id: 2, title: 'Two' },
        ]),
        'tabview-groups': JSON.stringify({ activeGroupId: 2, nextID: 3 }),
      },
      tabs: [
        {
          entries: [{ url: 'https://a/', title: 'A' }],
          extData: { 'tabview-tab': JSON.stringify({ groupID: 2 }) },
          pinned: false,
          lastAccessed: 12345,
        },
      ],
      ...overrides,
    });

    const old = (windows: unknown[], name = 'tabGroups') =>
      JSON.stringify({ version: [name, 1], windows });

    it('converts the windows, groups and tabs', () => {
      expect(parseBackup(old([oldWindow()]))).toEqual({
        file: { type: 'tgvView', version: 1 },
        windows: [
          {
            groups: [
              { id: 1, name: 'One', rect: { x: 0, y: 0, w: 0.25, h: 0.5 } },
              {
                id: 2,
                name: 'Two',
                rect: { x: 0.25, y: 1 / 32, w: 0.25, h: 0.5 },
              },
            ],
            tabs: [
              {
                url: 'https://a/',
                title: 'A',
                groupId: 2,
                index: 0,
                lastAccessed: 12345,
                pinned: false,
              },
            ],
            activeGroup: 2,
            groupIndex: 3,
            position: { left: 5, top: 6, width: 800, height: 600 },
          },
        ],
      });
    });

    it('also takes a backup of a session restore', () => {
      expect(
        parseBackup(old([oldWindow()], 'sessionrestore'))?.windows,
      ).toHaveLength(1);
    });

    it('spreads many groups across the width, at a pace of one more than the groups', () => {
      const groups = Array.from({ length: 5 }, (_, index) => ({
        id: index,
        title: `G${String(index)}`,
      }));
      const parsed = parseBackup(
        old([
          oldWindow({
            extData: {
              'tabview-group': JSON.stringify(groups),
              'tabview-groups': JSON.stringify({}),
            },
          }),
        ]),
      );

      expect(parsed?.windows[0]?.groups.map((group) => group.rect.x)).toEqual([
        0,
        1 / 6,
        2 / 6,
        3 / 6,
        4 / 6,
      ]);
    });

    it('spreads up to three groups at a quarter of the width apart', () => {
      const parsed = parseBackup(old([oldWindow()]));

      expect(parsed?.windows[0]?.groups[1]?.rect.x).toBe(0.25);
    });

    it('spreads four groups at a fifth of the width apart', () => {
      const groups = Array.from({ length: 4 }, (_, index) => ({
        id: index,
        title: 'x',
      }));
      const parsed = parseBackup(
        old([
          oldWindow({
            extData: {
              'tabview-group': JSON.stringify(groups),
              'tabview-groups': JSON.stringify({}),
            },
          }),
        ]),
      );

      expect(parsed?.windows[0]?.groups[1]?.rect.x).toBe(0.2);
    });

    it('takes the groups of an object, as Tab Groups keeps them by id', () => {
      const parsed = parseBackup(
        old([
          oldWindow({
            extData: {
              'tabview-group': JSON.stringify({
                7: { id: 7, title: 'Seven' },
              }),
              'tabview-groups': JSON.stringify({}),
            },
          }),
        ]),
      );

      expect(parsed?.windows[0]?.groups.map((group) => group.name)).toEqual([
        'Seven',
      ]);
    });

    it('drops a group that has no id or title', () => {
      const parsed = parseBackup(
        old([
          oldWindow({
            extData: {
              'tabview-group': JSON.stringify([
                { id: 1, title: 'Ok' },
                { id: 'x', title: 'Bad' },
                { id: 2 },
                null,
              ]),
              'tabview-groups': JSON.stringify({}),
            },
          }),
        ]),
      );

      expect(parsed?.windows[0]?.groups.map((group) => group.id)).toEqual([1]);
    });

    it('puts a pinned tab in the first group, whatever it says', () => {
      const parsed = parseBackup(
        old([
          oldWindow({
            tabs: [
              {
                entries: [{ url: 'https://p/' }],
                extData: { 'tabview-tab': JSON.stringify({ groupID: 5 }) },
                pinned: true,
              },
            ],
          }),
        ]),
      );

      expect(parsed?.windows[0]?.tabs[0]).toMatchObject({
        groupId: 0,
        pinned: true,
        title: undefined,
        lastAccessed: undefined,
      });
    });

    it('drops a tab that has no group, and keeps the index the others had', () => {
      const tab = (url: string, extData?: unknown) => ({
        entries: [{ url }],
        pinned: false,
        ...(extData === undefined ? {} : { extData }),
      });
      const parsed = parseBackup(
        old([
          oldWindow({
            tabs: [
              tab('https://none/'),
              tab('https://a/', {
                'tabview-tab': JSON.stringify({ groupID: 1 }),
              }),
              tab('https://broken/', { 'tabview-tab': 'not json' }),
              tab('https://b/', {
                'tabview-tab': JSON.stringify({ groupID: 2 }),
              }),
            ],
          }),
        ]),
      );

      expect(
        parsed?.windows[0]?.tabs.map((each) => [each.url, each.index]),
      ).toEqual([
        ['https://a/', 1],
        ['https://b/', 3],
      ]);
    });

    it.each([
      ['no entries', { pinned: true }],
      ['no first entry', { entries: [], pinned: true }],
      ['an entry that is not one', { entries: ['x'], pinned: true }],
      ['an entry with no address', { entries: [{}], pinned: true }],
      ['a tab that is not one', 'tab'],
      [
        'a tab with a group that is not a number',
        {
          entries: [{ url: 'a' }],
          extData: { 'tabview-tab': JSON.stringify({ groupID: 'x' }) },
        },
      ],
      [
        'a tab whose data is not an object',
        {
          entries: [{ url: 'a' }],
          extData: { 'tabview-tab': '5' },
        },
      ],
    ])('drops %s', (_name, oldTab) => {
      const parsed = parseBackup(old([oldWindow({ tabs: [oldTab] })]));

      expect(parsed?.windows[0]?.tabs).toEqual([]);
    });

    it.each([
      ['a window that is not one', 'window'],
      ['a window with no tabs', oldWindow({ tabs: undefined })],
      ['a window with no group data', oldWindow({ extData: {} })],
      [
        'a window whose group data is not JSON',
        oldWindow({
          extData: { 'tabview-group': '{', 'tabview-groups': '{}' },
        }),
      ],
      [
        'a window whose group data is not text',
        oldWindow({
          extData: { 'tabview-group': 5, 'tabview-groups': '{}' },
        }),
      ],
      [
        'a window whose settings are not an object',
        oldWindow({
          extData: { 'tabview-group': '[]', 'tabview-groups': '5' },
        }),
      ],
      [
        'a window whose groups are not a list or object',
        oldWindow({
          extData: { 'tabview-group': '5', 'tabview-groups': '{}' },
        }),
      ],
      ['a window with no extra data', oldWindow({ extData: undefined })],
    ])('drops %s', (_name, oldWindowValue) => {
      expect(parseBackup(old([oldWindowValue]))?.windows).toEqual([]);
    });

    it('is nothing when the windows are not a list', () => {
      expect(
        parseBackup(JSON.stringify({ version: ['tabGroups', 1] })),
      ).toBeUndefined();
    });

    it('has no active group or group index when the settings lack them', () => {
      const parsed = parseBackup(
        old([
          oldWindow({
            extData: {
              'tabview-group': '[]',
              'tabview-groups': JSON.stringify({ activeGroupId: 'x' }),
            },
          }),
        ]),
      );

      expect(parsed?.windows[0]?.activeGroup).toBeUndefined();
      expect(parsed?.windows[0]?.groupIndex).toBeUndefined();
    });
  });

  describe('groupsToOpen', () => {
    const base: BackupWindow = {
      groups: [],
      tabs: [],
      activeGroup: undefined,
      groupIndex: undefined,
      position: undefined,
    };
    const tab = (groupId: number | undefined) => ({
      url: 'u',
      title: undefined,
      groupId,
      index: undefined,
      lastAccessed: undefined,
      pinned: false,
    });

    it('is the groups the window has', () => {
      const groups = [{ id: 4, name: 'Four', rect }];

      expect(groupsToOpen({ ...base, groups, tabs: [tab(9)] })).toBe(groups);
    });

    it('is a group for each group the tabs were in, side by side', () => {
      expect(
        groupsToOpen({ ...base, tabs: [tab(5), tab(7), tab(5), tab(0)] }),
      ).toEqual([
        { id: 5, name: 'Group 5', rect: { x: 0, y: 0, w: 1 / 3, h: 0.5 } },
        { id: 7, name: 'Group 7', rect: { x: 1 / 3, y: 0, w: 1 / 3, h: 0.5 } },
        { id: 0, name: 'Group 0', rect: { x: 2 / 3, y: 0, w: 1 / 3, h: 0.5 } },
      ]);
    });

    it('leaves out tabs that were in no group', () => {
      expect(
        groupsToOpen({ ...base, tabs: [tab(undefined), tab(3)] }).map(
          (group) => group.id,
        ),
      ).toEqual([3]);
    });

    it('is nothing when there are no tabs either', () => {
      expect(groupsToOpen(base)).toEqual([]);
    });
  });

  describe('backupFileName', () => {
    it('is the date and time in local time, with two digits each', () => {
      expect(backupFileName(new Date(2026, 0, 5, 3, 4, 9))).toBe(
        'tgvView-backup-260105-030409.json',
      );
    });

    it('takes the last two digits of the year, and two digits for the rest', () => {
      expect(backupFileName(new Date(2005, 10, 25, 23, 59, 58))).toBe(
        'tgvView-backup-051125-235958.json',
      );
    });
  });
});
