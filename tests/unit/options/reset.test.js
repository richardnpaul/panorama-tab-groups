import resetPTG from '../../../src/js/options/reset.js';

describe('options/reset.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.window = {
      alert: vi.fn(),
    };
  });

  it('alerts not implemented', () => {
    resetPTG();
    expect(global.window.alert).toHaveBeenCalledWith('Not implemented yet');
  });
});
