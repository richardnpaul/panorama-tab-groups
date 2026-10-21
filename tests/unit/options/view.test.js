import {
  showViewSpecificOptions,
  saveOptionView,
} from '../../../src/js/options/view.js';

describe('options/view.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.browser = {
      storage: {
        sync: {
          set: jest.fn().mockResolvedValue(),
        },
      },
      runtime: {
        sendMessage: jest.fn().mockResolvedValue(),
      },
    };

    global.document = {
      querySelector: jest.fn((selector) => {
        if (selector === '#optionsToolbar') {
          return {
            setAttribute: jest.fn(),
            removeAttribute: jest.fn(),
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
        setAttribute: jest.fn(),
        removeAttribute: jest.fn(),
      };
      global.document.querySelector.mockReturnValueOnce(mockToolbar);

      showViewSpecificOptions('freeform');

      expect(mockToolbar.setAttribute).toHaveBeenCalledWith('hidden', true);
      expect(mockToolbar.removeAttribute).toHaveBeenCalledWith('hidden');
    });

    it('hides freeform specific options for other views', () => {
      const mockToolbar = {
        setAttribute: jest.fn(),
        removeAttribute: jest.fn(),
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
        setAttribute: jest.fn(),
        removeAttribute: jest.fn(),
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
