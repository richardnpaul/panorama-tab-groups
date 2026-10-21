import addTranslations from '../../../src/js/options/translations.js';

describe('options/translations.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    global.browser = {
      i18n: {
        getMessage: vi.fn((key) => `translated-${key}`),
      },
    };

    const createElement = () => ({
      textContent: '',
      href: '',
    });

    global.document = {
      querySelector: vi.fn().mockReturnValue(createElement()),
      querySelectorAll: vi
        .fn()
        .mockReturnValue([createElement(), createElement()]),
    };
  });

  it('translates all strings in the DOM', () => {
    addTranslations();

    expect(global.browser.i18n.getMessage).toHaveBeenCalled();
    expect(global.document.querySelector).toHaveBeenCalledWith(
      '#optionKeyboardShortcuts h2',
    );
    expect(global.document.querySelectorAll).toHaveBeenCalledWith(
      '#optionKeyboardShortcuts .updateShortcut',
    );
  });
});
