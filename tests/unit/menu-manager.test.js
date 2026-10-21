import {
  addRefreshMenuItem,
  createMenuList,
  handleMenuChange,
} from '../../src/js/background/menu-manager.js';
import { stateManager } from '../../src/js/background/StateManager.js';

// Mock dependencies
jest.mock('../../src/js/background/StateManager.js', () => ({
  stateManager: {
    getGroups: jest.fn(),
  },
}));

let contextMenusCreateMock;
let contextMenusRemoveMock;
let contextMenusUpdateMock;
let contextMenusRemoveAllMock;

beforeEach(() => {
  contextMenusCreateMock = jest.fn();
  contextMenusRemoveMock = jest.fn();
  contextMenusUpdateMock = jest.fn();
  contextMenusRemoveAllMock = jest.fn().mockResolvedValue();

  globalThis.browser = {
    contextMenus: {
      create: contextMenusCreateMock,
      remove: contextMenusRemoveMock,
      update: contextMenusUpdateMock,
      removeAll: contextMenusRemoveAllMock,
    },
    menus: {
      create: contextMenusCreateMock,
    },
    windows: {
      getCurrent: jest.fn().mockResolvedValue({ id: 1 }),
    },
    i18n: {
      getMessage: jest.fn((key) => key), // just return the key as the string
    },
  };

  jest.clearAllMocks();
});

describe('Menu Manager Unit Tests', () => {
  describe('addRefreshMenuItem', () => {
    it('removes existing and creates new refresh items', async () => {
      contextMenusRemoveMock.mockResolvedValue(); // Success
      await addRefreshMenuItem();

      expect(contextMenusRemoveMock).toHaveBeenCalledWith('refresh-groups');
      expect(contextMenusRemoveMock).toHaveBeenCalledWith('refresh-spacer');

      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'refresh-spacer',
          type: 'separator',
          contexts: ['tab'],
        }),
      );
      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'refresh-groups', contexts: ['tab'] }),
      );
    });

    it('ignores errors during removal', async () => {
      contextMenusRemoveMock.mockRejectedValue(new Error('Does not exist'));

      // Should not throw
      await expect(addRefreshMenuItem()).resolves.not.toThrow();
      expect(contextMenusCreateMock).toHaveBeenCalledTimes(2);
    });

    it('falls back to contexts=["all"] if contexts=["tab"] throws', async () => {
      // First call throws error
      contextMenusCreateMock.mockImplementationOnce(() => {
        throw new Error('Unsupported context');
      });

      await addRefreshMenuItem();

      // Should retry with 'all'
      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'refresh-spacer',
          type: 'separator',
          contexts: ['all'],
        }),
      );
    });
  });

  describe('createMenuList', () => {
    it('aborts if groups are not initialized', async () => {
      stateManager.getGroups.mockResolvedValue(null);
      await createMenuList();

      expect(contextMenusRemoveAllMock).toHaveBeenCalled();
      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'send-tab' }),
      );
      // No group items should be created
      expect(contextMenusCreateMock).toHaveBeenCalledTimes(1);
    });

    it('uses fallback title for send-tab menu if i18n returns falsy value', async () => {
      globalThis.browser.i18n.getMessage.mockImplementation((key) => {
        if (key === 'sendTabToGroup') return null;
        return key;
      });
      stateManager.getGroups.mockResolvedValue([]);

      await createMenuList();

      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'send-tab',
          title: 'Send Tab to Group',
        }),
      );
    });

    it('creates menu items for all groups', async () => {
      stateManager.getGroups.mockResolvedValue([
        { id: 1, name: 'Group 1' },
        { id: 2, name: 'Group 2' },
      ]);
      await createMenuList();

      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'send-tab' }),
      );
      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', title: '1: Group 1' }),
      );
      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: '2', title: '2: Group 2' }),
      );
      // addRefreshMenuItem is called which adds 2 more items
      expect(contextMenusCreateMock).toHaveBeenCalledTimes(1 + 2 + 2);
    });

    it('falls back to contexts=["all"] for group items if contexts=["tab"] throws', async () => {
      stateManager.getGroups.mockResolvedValue([{ id: 1, name: 'Group 1' }]);

      // We only want the group create to throw, but contextMenusCreateMock is used for everything.
      // 1st call: send-tab (browser.menus.create) -> works fine
      // 2nd call: group 1 (browser.contextMenus.create) -> throws
      contextMenusCreateMock.mockImplementation((opts) => {
        if (opts.id === '1' && opts.contexts.includes('tab')) {
          throw new Error('Unsupported context');
        }
      });

      await createMenuList();

      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          id: '1',
          title: '1: Group 1',
          contexts: ['all'],
        }),
      );
    });

    it('logs error if completely fails', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      contextMenusRemoveAllMock.mockRejectedValue(
        new Error('Catastrophic failure'),
      );

      await createMenuList();

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to create menu list:',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('handleMenuChange', () => {
    it('handles createMenuItem', async () => {
      await handleMenuChange({
        action: 'createMenuItem',
        groupId: 99,
        groupName: 'NewGroup',
      });
      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: '99', title: '99: NewGroup' }),
      );
      // And calls addRefreshMenuItem
      expect(contextMenusCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'refresh-spacer' }),
      );
    });

    it('handles removeMenuItem successfully', async () => {
      contextMenusRemoveMock.mockResolvedValue();
      await handleMenuChange({ action: 'removeMenuItem', groupId: 99 });
      expect(contextMenusRemoveMock).toHaveBeenCalledWith('99');
    });

    it('handles removeMenuItem error gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      contextMenusRemoveMock.mockRejectedValue(new Error('Does not exist'));
      await handleMenuChange({ action: 'removeMenuItem', groupId: 99 });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Could not remove menu item 99:',
        'Does not exist',
      );
      consoleSpy.mockRestore();
    });

    it('handles updateMenuItem', async () => {
      await handleMenuChange({
        action: 'updateMenuItem',
        groupId: 99,
        groupName: 'Updated',
      });
      expect(contextMenusUpdateMock).toHaveBeenCalledWith('99', {
        title: '99: Updated',
      });
    });

    it('ignores unknown actions', async () => {
      await handleMenuChange({ action: 'unknownAction' });
      expect(contextMenusCreateMock).not.toHaveBeenCalled();
      expect(contextMenusRemoveMock).not.toHaveBeenCalled();
      expect(contextMenusUpdateMock).not.toHaveBeenCalled();
    });
  });
});
