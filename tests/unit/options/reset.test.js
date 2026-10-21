import resetPTG from '../../../src/js/options/reset.js';

describe('options/reset.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.window = {
      alert: jest.fn(),
    };
  });

  it('alerts not implemented', () => {
    resetPTG();
    expect(global.window.alert).toHaveBeenCalledWith('Not implemented yet');
  });
});
