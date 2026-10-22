// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import resetPTG from '../../../src/js/options/reset.js';

describe('options/reset.ts', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('tells the user that resetting is not implemented', () => {
    const alert = vi.spyOn(window, 'alert').mockImplementation(() => undefined);

    resetPTG();

    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith('Not implemented yet');
  });
});
