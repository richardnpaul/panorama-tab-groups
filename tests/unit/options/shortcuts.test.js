describe('options/shortcuts.js', () => {
  let updateShortcut;
  let resetShortcut;
  let disableShortcutForm;
  let disableShortcut;
  let enableShortcutForm;
  let enableShortcut;

  beforeEach(() => {
    jest.clearAllMocks();

    global.browser = {
      commands: {
        update: jest.fn().mockResolvedValue(),
        reset: jest.fn().mockResolvedValue(),
        getAll: jest.fn().mockResolvedValue([
          { name: 'test-shortcut', shortcut: 'Ctrl+A' },
          { name: 'other-shortcut', shortcut: 'Ctrl+B' },
        ]),
      },
      storage: {
        sync: {
          set: jest.fn().mockResolvedValue(),
        },
      },
    };

    const buttonMock = {
      hidden: false,
      getAttribute: jest.fn(),
      setAttribute: jest.fn(),
      removeAttribute: jest.fn(),
      parentElement: { getAttribute: () => 'test-shortcut' },
    };

    const mockElements = {
      '#test-shortcut input': { value: 'Ctrl+A', disabled: false },
      '.updateShortcut': buttonMock,
      '.resetShortcut': buttonMock,
      '.enableShortcut': buttonMock,
      '.disableShortcut': buttonMock,
      '#test-shortcut .updateShortcut': buttonMock,
      '#test-shortcut .resetShortcut': buttonMock,
      '#test-shortcut .enableShortcut': buttonMock,
      '#test-shortcut .disableShortcut': buttonMock,
    };

    global.document = {
      querySelector: jest.fn((selector) => {
        if (mockElements[selector]) return mockElements[selector];
        return buttonMock;
      }),
    };

    jest.isolateModules(() => {
      // eslint-disable-next-line global-require
      const shortcuts = require('../../../src/js/options/shortcuts.js');
      updateShortcut = shortcuts.updateShortcut;
      resetShortcut = shortcuts.resetShortcut;
      disableShortcutForm = shortcuts.disableShortcutForm;
      disableShortcut = shortcuts.disableShortcut;
      enableShortcutForm = shortcuts.enableShortcutForm;
      enableShortcut = shortcuts.enableShortcut;
    });
  });

  describe('updateShortcut', () => {
    it('updates a shortcut with browser API', async () => {
      document.querySelector('#test-shortcut input').value = 'Ctrl+B';
      const event = {
        preventDefault: jest.fn(),
        target: document.querySelector('.updateShortcut'),
      };

      await updateShortcut(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(global.browser.commands.update).toHaveBeenCalledWith({
        name: 'test-shortcut',
        shortcut: 'Ctrl+B',
      });
    });
  });

  describe('resetShortcut', () => {
    it('resets a shortcut and updates the input value', async () => {
      document.querySelector('#test-shortcut input').value = 'Ctrl+B';
      const event = {
        preventDefault: jest.fn(),
        target: document.querySelector('.resetShortcut'),
      };

      await resetShortcut(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(global.browser.commands.reset).toHaveBeenCalledWith(
        'test-shortcut',
      );
      expect(global.browser.commands.getAll).toHaveBeenCalled();
      expect(document.querySelector('#test-shortcut input').value).toBe(
        'Ctrl+A',
      );
    });
  });

  describe('disableShortcutForm', () => {
    it('disables the form inputs and buttons', () => {
      disableShortcutForm('test-shortcut');

      expect(document.querySelector('#test-shortcut input').disabled).toBe(
        true,
      );
      expect(
        document.querySelector('.updateShortcut').setAttribute,
      ).toHaveBeenCalledWith('hidden', true);
      expect(
        document.querySelector('.resetShortcut').setAttribute,
      ).toHaveBeenCalledWith('hidden', true);
      expect(
        document.querySelector('.disableShortcut').setAttribute,
      ).toHaveBeenCalledWith('hidden', true);
      expect(
        document.querySelector('.enableShortcut').removeAttribute,
      ).toHaveBeenCalledWith('hidden');
    });
  });

  describe('disableShortcut', () => {
    it('saves disabled state to options and calls disableShortcutForm', async () => {
      const options = { shortcut: {} };
      const event = {
        preventDefault: jest.fn(),
        target: document.querySelector('.disableShortcut'),
      };

      await disableShortcut(options, event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(options.shortcut['test-shortcut']).toEqual({ disabled: true });
      expect(global.browser.storage.sync.set).toHaveBeenCalledWith(options);
      expect(document.querySelector('#test-shortcut input').disabled).toBe(
        true,
      );
    });
  });

  describe('enableShortcutForm', () => {
    it('enables the form inputs and buttons', () => {
      // Setup disabled state first
      disableShortcutForm('test-shortcut');

      enableShortcutForm('test-shortcut');

      expect(document.querySelector('#test-shortcut input').disabled).toBe(
        false,
      );
      expect(
        document.querySelector('.updateShortcut').removeAttribute,
      ).toHaveBeenCalledWith('hidden');
      expect(
        document.querySelector('.resetShortcut').removeAttribute,
      ).toHaveBeenCalledWith('hidden');
      expect(
        document.querySelector('.disableShortcut').removeAttribute,
      ).toHaveBeenCalledWith('hidden');
      expect(
        document.querySelector('.enableShortcut').setAttribute,
      ).toHaveBeenCalledWith('hidden', true);
    });
  });

  describe('enableShortcut', () => {
    it('saves enabled state to options and calls enableShortcutForm', async () => {
      const options = { shortcut: { 'test-shortcut': { disabled: true } } };
      const event = {
        preventDefault: jest.fn(),
        target: document.querySelector('.enableShortcut'),
      };

      await enableShortcut(options, event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(options.shortcut['test-shortcut']).toEqual({ disabled: false });
      expect(global.browser.storage.sync.set).toHaveBeenCalledWith(options);
      expect(document.querySelector('#test-shortcut input').disabled).toBe(
        false,
      );
    });
  });
});
