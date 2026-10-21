import saveOptionTheme from '../../../src/js/options/theme.js';

describe('options/theme.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.browser = {
      storage: {
        sync: {
          set: vi.fn().mockResolvedValue(),
        },
      },
    };
    global.document = {
      querySelector: vi.fn().mockReturnValue({ value: 'dark' }),
    };
  });

  it('saves selected theme to storage', async () => {
    await saveOptionTheme();
    expect(global.document.querySelector).toHaveBeenCalledWith(
      'input[name="theme"]:checked',
    );
    expect(global.browser.storage.sync.set).toHaveBeenCalledWith({
      theme: 'dark',
    });
  });
});
