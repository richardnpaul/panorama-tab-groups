import { loadBackup, saveBackup } from '../../../src/js/options/backup.js';

let mockView = 'panorama';
jest.mock('../../../src/js/share/options.js', () => ({
  get currentOptions() {
    return Promise.resolve({ view: mockView });
  },
}));

describe('options/backup.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockView = 'panorama';

    global.browser = {
      runtime: {
        sendMessage: jest.fn().mockResolvedValue(),
      },
      windows: {
        create: jest.fn().mockResolvedValue({ id: 1 }),
        update: jest.fn().mockResolvedValue(),
        getAll: jest.fn().mockResolvedValue([{ id: 1 }]),
      },
      sessions: {
        setWindowValue: jest.fn().mockResolvedValue(),
        getWindowValue: jest
          .fn()
          .mockResolvedValue([{ id: 1, name: 'Group 1', rect: {} }]),
        setTabValue: jest.fn().mockResolvedValue(),
        getTabValue: jest.fn().mockImplementation((tabId, key) => {
          if (key === 'groupId') {
            return tabId === 11 ? -1 : 1;
          }
          return null;
        }),
      },
      tabs: {
        create: jest.fn().mockResolvedValue({ id: 10 }),
        query: jest.fn().mockResolvedValue([
          {
            id: 10,
            url: 'http://example.com',
            title: 'Example',
            index: 0,
            lastAccessed: 1234,
            pinned: false,
          },
          {
            id: 11,
            url: 'http://pinned.com',
            title: 'Pinned',
            index: 1,
            lastAccessed: 1234,
            pinned: true,
          },
        ]),
        remove: jest.fn().mockResolvedValue(),
      },
      downloads: {
        download: jest.fn().mockResolvedValue(),
      },
    };

    global.window = {
      URL: {
        createObjectURL: jest.fn().mockReturnValue('blob:mock'),
      },
    };

    global.Blob = jest.fn();
    global.alert = jest.fn();

    // Mock FileReader
    global.FileReader = class {
      readAsText(file) {
        if (this.onload) {
          this.onload({ target: { result: file.content } });
        }
      }
    };
  });

  describe('saveBackup', () => {
    it('creates a backup blob and downloads it', async () => {
      await saveBackup();

      expect(global.browser.windows.getAll).toHaveBeenCalled();
      expect(global.browser.downloads.download).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'blob:mock',
          conflictAction: 'uniquify',
          saveAs: true,
        }),
      );
    });

    it('creates a backup even if no groups are returned by getWindowValue', async () => {
      global.browser.sessions.getWindowValue.mockResolvedValueOnce(null);
      await saveBackup();
      expect(global.browser.downloads.download).toHaveBeenCalled();
    });
  });

  describe('loadBackup', () => {
    it('alerts on invalid file type', () => {
      const input = {
        target: {
          files: [{ type: 'image/png' }],
        },
      };

      loadBackup(input);
      expect(global.alert).toHaveBeenCalledWith('Invalid file');
    });

    it('alerts on invalid JSON content', () => {
      const input = {
        target: {
          files: [{ type: 'application/json', content: '{"invalid": true}' }],
        },
      };

      loadBackup(input);
      expect(global.alert).toHaveBeenCalledWith('Invalid file');
    });

    it('loads a valid panoramaView backup', async () => {
      const backupData = {
        file: { type: 'panoramaView', version: 1 },
        windows: [
          {
            groups: [
              { id: 1, name: 'G1', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
            ],
            tabs: [
              { url: 'http://example.com', groupId: 1, pinned: false },
              { url: 'http://pinned.com', groupId: 1, pinned: true },
            ],
            activeGroup: 1,
            groupIndex: 2,
            position: { left: 0, top: 0, width: 800, height: 600 },
          },
        ],
      };

      const input = {
        target: {
          files: [
            { type: 'application/json', content: JSON.stringify(backupData) },
          ],
        },
      };

      global.browser.tabs.query.mockImplementation((queryInfo) => {
        if (queryInfo.active === true) {
          return Promise.resolve([{ id: 12 }]);
        }
        return Promise.resolve([]);
      });

      loadBackup(input);

      // We need to wait a tick because openBackup is async
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'setBackgroundState',
        key: 'openingBackup',
        value: true,
      });

      expect(global.browser.windows.create).toHaveBeenCalled();
      expect(global.browser.tabs.create).toHaveBeenCalled();
      expect(global.browser.tabs.remove).toHaveBeenCalledWith(12);
      expect(global.browser.sessions.setTabValue).toHaveBeenCalled();

      expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'setBackgroundState',
        key: 'openingBackup',
        value: false,
      });
    });

    it('loads freeform view backup', async () => {
      mockView = 'freeform';
      const backupData = {
        file: { type: 'panoramaView', version: 1 },
        windows: [
          {
            groups: [
              { id: 1, name: 'G1', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
            ],
            tabs: [{ url: 'http://example.com', groupId: 1, pinned: false }],
            activeGroup: 1,
            groupIndex: 2,
          },
        ],
      };

      const input = {
        target: {
          files: [
            { type: 'application/json', content: JSON.stringify(backupData) },
          ],
        },
      };

      loadBackup(input);
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(global.browser.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: '/view.html',
          active: true,
        }),
      );
    });

    it('handles tab creation error', async () => {
      const backupData = {
        file: { type: 'panoramaView', version: 1 },
        windows: [
          {
            groups: [
              { id: 1, name: 'G1', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
            ],
            tabs: [{ url: 'http://example.com', groupId: 1, pinned: false }],
            activeGroup: 1,
            groupIndex: 2,
          },
        ],
      };

      global.browser.tabs.create.mockRejectedValueOnce(
        new Error('Tab create error'),
      );

      const input = {
        target: {
          files: [
            { type: 'application/json', content: JSON.stringify(backupData) },
          ],
        },
      };

      loadBackup(input);
      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(global.browser.tabs.create).toHaveBeenCalled();
    });

    it('converts and loads an old tabGroups backup', async () => {
      const oldBackupData = {
        version: ['tabGroups', 1],
        windows: [
          {
            screenX: 0,
            screenY: 0,
            width: 800,
            height: 600,
            extData: {
              'tabview-group': JSON.stringify([{ id: 1, title: 'Group 1' }]),
              'tabview-groups': JSON.stringify({ activeGroupId: 1, nextID: 2 }),
            },
            tabs: [
              {
                entries: [{ url: 'http://test.com', title: 'Test' }],
                extData: { 'tabview-tab': JSON.stringify({ groupID: 1 }) },
                pinned: false,
                lastAccessed: 12345,
              },
              {
                entries: [
                  { url: 'http://pinned-old.com', title: 'Pinned Old' },
                ],
                pinned: true,
                lastAccessed: 12345,
              },
              {
                entries: [
                  { url: 'http://missing-group.com', title: 'Missing Group' },
                ],
                pinned: false,
                lastAccessed: 12345,
              },
            ],
          },
        ],
      };

      const input = {
        target: {
          files: [
            {
              type: 'application/json',
              content: JSON.stringify(oldBackupData),
            },
          ],
        },
      };

      loadBackup(input);

      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(global.browser.windows.create).toHaveBeenCalled();
      expect(global.browser.tabs.create).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://test.com',
        }),
      );
    });

    it('creates groups from tabs if missing in backup', async () => {
      const backupData = {
        file: { type: 'panoramaView', version: 1 },
        windows: [
          {
            groups: [],
            tabs: [
              { url: 'http://example.com', groupId: 1, pinned: false },
              { url: 'http://example2.com', groupId: 2, pinned: false },
            ],
            activeGroup: 1,
            groupIndex: 2,
          },
        ],
      };

      const input = {
        target: {
          files: [
            { type: 'application/json', content: JSON.stringify(backupData) },
          ],
        },
      };

      loadBackup(input);

      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(global.browser.windows.create).toHaveBeenCalled();
      expect(global.browser.sessions.setWindowValue).toHaveBeenCalledWith(
        expect.anything(),
        'groups',
        expect.arrayContaining([
          expect.objectContaining({ id: 1, name: 'Group 1' }),
          expect.objectContaining({ id: 2, name: 'Group 2' }),
        ]),
      );
    });

    it('converts and loads an old sessionrestore backup with nGroups >= 4', async () => {
      const oldBackupData = {
        version: ['sessionrestore', 1],
        windows: [
          {
            screenX: 0,
            screenY: 0,
            width: 800,
            height: 600,
            extData: {
              'tabview-group': JSON.stringify([
                { id: 1, title: 'Group 1' },
                { id: 2, title: 'Group 2' },
                { id: 3, title: 'Group 3' },
                { id: 4, title: 'Group 4' },
                { id: 5, title: 'Group 5' },
              ]),
              'tabview-groups': JSON.stringify({ activeGroupId: 1, nextID: 6 }),
            },
            tabs: [
              {
                entries: [{ url: 'http://test.com', title: 'Test' }],
                extData: { 'tabview-tab': JSON.stringify({ groupID: 1 }) },
                pinned: false,
                lastAccessed: 12345,
              },
            ],
          },
        ],
      };

      const input = {
        target: {
          files: [
            {
              type: 'application/json',
              content: JSON.stringify(oldBackupData),
            },
          ],
        },
      };

      loadBackup(input);

      await new Promise(process.nextTick);
      await new Promise(process.nextTick);

      expect(global.browser.windows.create).toHaveBeenCalled();
    });
  });
});
