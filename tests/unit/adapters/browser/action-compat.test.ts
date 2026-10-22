import { describe, expect, it, vi } from 'vitest';
import {
  retryWithoutWindowId,
  type TitleDetails,
} from '../../../../src/js/adapters/browser/action-compat.js';

const withoutWindow = ({ windowId, ...rest }: TitleDetails): TitleDetails =>
  rest;
const retry = (original: (details: TitleDetails) => Promise<void>) =>
  retryWithoutWindowId(original, withoutWindow);

describe('adapters/browser/action-compat.ts', () => {
  it('makes the call as it is when it works', async () => {
    const original = vi.fn().mockResolvedValue(undefined);

    await retry(original)({ title: 'T', windowId: 3 });

    expect(original).toHaveBeenCalledTimes(1);
    expect(original).toHaveBeenCalledWith({ title: 'T', windowId: 3 });
  });

  it('tries again without the window when the browser refuses it', async () => {
    const original = vi
      .fn()
      .mockRejectedValueOnce(new Error('windowId is not supported'))
      .mockResolvedValueOnce(undefined);

    await retry(original)({
      title: 'T',
      tabId: 9,
      windowId: 3,
    });

    expect(original).toHaveBeenCalledTimes(2);
    expect(original).toHaveBeenNthCalledWith(1, {
      title: 'T',
      tabId: 9,
      windowId: 3,
    });
    expect(original).toHaveBeenNthCalledWith(2, { title: 'T', tabId: 9 });
  });

  it('fails with the second error if the second try fails too', async () => {
    const second = new Error('second');
    const original = vi
      .fn()
      .mockRejectedValueOnce(new Error('first'))
      .mockRejectedValueOnce(second);

    await expect(retry(original)({ title: 'T', windowId: 1 })).rejects.toBe(
      second,
    );
  });

  it('retries a window id of 0 too', async () => {
    const original = vi
      .fn()
      .mockRejectedValueOnce(new Error('no'))
      .mockResolvedValueOnce(undefined);

    await retry(original)({ title: 'T', windowId: 0 });

    expect(original).toHaveBeenNthCalledWith(2, { title: 'T' });
  });

  it('fails with the original error when there was no window to leave out', async () => {
    const failure = new Error('really broken');
    const original = vi.fn().mockRejectedValue(failure);

    await expect(retry(original)({ title: 'T' })).rejects.toBe(failure);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it('does not change the details it was given', async () => {
    const original = vi
      .fn()
      .mockRejectedValueOnce(new Error('no'))
      .mockResolvedValueOnce(undefined);
    const details = { title: 'T', windowId: 3 };

    await retry(original)(details);

    expect(details).toEqual({ title: 'T', windowId: 3 });
  });
});
