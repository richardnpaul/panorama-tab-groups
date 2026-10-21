describe('options/shortcuts.js', () => {
  let updateShortcut;
  let resetShortcut;
  let disableShortcutForm;
  let disableShortcut;
  let enableShortcutForm;
  let enableShortcut;

  beforeEach(async () => {
    vi.clearAllMocks();

    global.browser = {
      commands: {
        update: vi.fn().mockResolvedValue(),
        reset: vi.fn().mockResolvedValue(),
        getAll: vi.fn().mockResolvedValue([
          { name: 'test-shortcut', shortcut: 'Ctrl+A' },
          { name: 'other-shortcut', shortcut: 'Ctrl+B' },
        ]),
      },
      storage: {
        sync: {
          set: vi.fn().mockResolvedValue(),
        },
      },
    };

    const buttonMock = {
      hidden: false,
      getAttribute: vi.fn(),
      setAttribute: vi.fn(),
      removeAttribute: vi.fn(),
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
      querySelector: vi.fn((selector) => {
        if (mockElements[selector]) return mockElements[selector];
        return buttonMock;
      }),
    };

    vi.resetModules();
    ({
      updateShortcut,
      resetShortcut,
      disableShortcutForm,
      disableShortcut,
      enableShortcutForm,
      enableShortcut,
    } = await import('../../../src/js/options/shortcuts.js'));
  });

  describe('updateShortcut', () => {
    it('updates a shortcut with browser API', async () => {
      document.querySelector('#test-shortcut input').value = 'Ctrl+B';
      const event = {
        preventDefault: vi.fn(),
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
        preventDefault: vi.fn(),
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
        preventDefault: vi.fn(),
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
        preventDefault: vi.fn(),
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
