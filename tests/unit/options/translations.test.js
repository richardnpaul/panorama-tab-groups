import addTranslations from '../../../src/js/options/translations.js';

describe('options/translations.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    global.browser = {
      i18n: {
        getMessage: jest.fn((key) => `translated-${key}`),
      },
    };

    const createElement = () => ({
      textContent: '',
      href: '',
    });

    global.document = {
      querySelector: jest.fn().mockReturnValue(createElement()),
      querySelectorAll: jest
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
