import saveOptionToolbarPosition from '../../../src/js/options/toolbar.js';

describe('options/toolbar.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.browser = {
      storage: {
        sync: {
          set: jest.fn().mockResolvedValue(),
        },
      },
    };
    global.document = {
      querySelector: jest.fn().mockReturnValue({ value: 'bottom' }),
    };
  });

  it('saves selected toolbar position to storage', async () => {
    await saveOptionToolbarPosition();
    expect(global.document.querySelector).toHaveBeenCalledWith(
      'input[name="toolbarPosition"]:checked',
    );
    expect(global.browser.storage.sync.set).toHaveBeenCalledWith({
      toolbarPosition: 'bottom',
    });
  });
});
