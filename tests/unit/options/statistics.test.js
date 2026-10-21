import getStatistics from '../../../src/js/options/statistics.js';
import * as utils from '../../../src/js/share/utils.js';

vi.mock('../../../src/js/share/utils.js', () => ({
  formatByteSize: vi.fn().mockReturnValue('100 B'),
}));

describe('options/statistics.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    global.browser = {
      tabs: {
        query: vi.fn().mockResolvedValue([
          { id: 1, discarded: false },
          { id: 2, discarded: true },
          { id: 3, discarded: false },
        ]),
      },
      sessions: {
        getTabValue: vi.fn().mockImplementation((id, key) => {
          if (key === 'thumbnail') {
            if (id === 1) return { thumbnail: 'A'.repeat(50) };
            if (id === 2) return 'A'.repeat(50);
            return null;
          }
          return null;
        }),
      },
      i18n: {
        getMessage: vi.fn().mockReturnValue('active'),
      },
    };

    global.document = {
      getElementById: vi.fn(() => ({
        replaceChildren: vi.fn(),
      })),
      createTextNode: vi.fn((text) => text),
    };

    global.console = {
      ...console,
      debug: vi.fn(),
    };
  });

  it('calculates and updates statistics in the DOM', async () => {
    await getStatistics();

    expect(global.browser.tabs.query).toHaveBeenCalledWith({});
    expect(global.browser.sessions.getTabValue).toHaveBeenCalledTimes(3);

    // totalSize should be 100 bytes (50 * 2)
    expect(utils.formatByteSize).toHaveBeenCalledWith(100);

    expect(global.document.getElementById).toHaveBeenCalledWith(
      'thumbnailCacheSize',
    );
    expect(global.document.getElementById).toHaveBeenCalledWith('numberOfTabs');

    expect(global.document.createTextNode).toHaveBeenCalledWith('100 B');
    expect(global.document.createTextNode).toHaveBeenCalledWith('3 (active 2)');
  });
});
