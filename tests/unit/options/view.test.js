import {
  showViewSpecificOptions,
  saveOptionView,
} from '../../../src/js/options/view.js';

describe('options/view.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.browser = {
      storage: {
        sync: {
          set: vi.fn().mockResolvedValue(),
        },
      },
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(),
      },
    };

    global.document = {
      querySelector: vi.fn((selector) => {
        if (selector === '#optionsToolbar') {
          return {
            setAttribute: vi.fn(),
            removeAttribute: vi.fn(),
          };
        }
        if (selector === 'input[name="view"]:checked') {
          return { value: 'freeform' };
        }
        return null;
      }),
    };
  });

  describe('showViewSpecificOptions', () => {
    it('shows freeform specific options', () => {
      const mockToolbar = {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      };
      global.document.querySelector.mockReturnValueOnce(mockToolbar);

      showViewSpecificOptions('freeform');

      expect(mockToolbar.setAttribute).toHaveBeenCalledWith('hidden', true);
      expect(mockToolbar.removeAttribute).toHaveBeenCalledWith('hidden');
    });

    it('hides freeform specific options for other views', () => {
      const mockToolbar = {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      };
      global.document.querySelector.mockReturnValueOnce(mockToolbar);

      showViewSpecificOptions('native');

      expect(mockToolbar.setAttribute).toHaveBeenCalledWith('hidden', true);
      expect(mockToolbar.removeAttribute).not.toHaveBeenCalled();
    });
  });

  describe('saveOptionView', () => {
    it('saves selected view and sends a refresh message', async () => {
      const mockToolbar = {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
      };

      global.document.querySelector.mockImplementation((selector) => {
        if (selector === 'input[name="view"]:checked')
          return { value: 'freeform' };
        if (selector === '#optionsToolbar') return mockToolbar;
        return null;
      });

      await saveOptionView();

      expect(global.browser.storage.sync.set).toHaveBeenCalledWith({
        view: 'freeform',
      });
      expect(global.browser.runtime.sendMessage).toHaveBeenCalledWith({
        action: 'refreshView',
      });
      expect(mockToolbar.removeAttribute).toHaveBeenCalledWith('hidden');
    });
  });
});
