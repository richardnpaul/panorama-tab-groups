import { describe, expect, it, vi } from 'vitest';
import { createMemoryToolbar } from '../../../src/js/adapters/memory/toolbar.js';
import { createViewRefresh } from '../../../src/js/app/view-refresh.js';
import type { Options } from '../../../src/js/share/options.js';

const optionsWith = (view: string): Options => ({
  toolbarPosition: 'top',
  useNativeGroups: true,
  shortcut: {},
  theme: 'auto',
  view,
});

function setUp(view = 'popup') {
  let current = optionsWith(view);
  const toolbar = createMemoryToolbar();
  const logger = { debug: vi.fn() };
  return {
    refresh: createViewRefresh({
      options: { load: () => Promise.resolve(current) },
      toolbar,
      logger,
    }),
    toolbar,
    logger,
    choose(next: string) {
      current = optionsWith(next);
    },
  };
}

describe('app/view-refresh.ts', () => {
  describe('applyPopup', () => {
    it('makes the button open the popup when that is the view chosen', async () => {
      const env = setUp('popup');

      await env.refresh.applyPopup();

      expect(env.toolbar.popup).toBe('popup-view/index.html');
    });

    it.each([['freeform'], ['tiling'], ['']])(
      'makes the button just click for the view %j',
      async (view) => {
        const env = setUp(view);

        await env.refresh.applyPopup();

        expect(env.toolbar.popup).toBe('');
      },
    );
  });

  describe('refreshView', () => {
    it('orders pages to reload, and applies the choice made', async () => {
      const env = setUp('freeform');
      expect(env.refresh.isOrdered()).toBe(false);
      env.choose('popup');

      await env.refresh.refreshView();

      expect(env.refresh.isOrdered()).toBe(true);
      expect(env.toolbar.popup).toBe('popup-view/index.html');
      expect(env.logger.debug).toHaveBeenCalledWith(
        'Refresh Panorama Tab View',
      );
    });

    it('is ordered even when the popup cannot be set', async () => {
      const env = setUp();
      env.toolbar.failWith(new Error('no'));

      await expect(env.refresh.refreshView()).rejects.toThrow('no');

      expect(env.refresh.isOrdered()).toBe(true);
    });
  });

  describe('clear', () => {
    it('ends the order', async () => {
      const env = setUp();
      await env.refresh.refreshView();

      env.refresh.clear();

      expect(env.refresh.isOrdered()).toBe(false);
    });
  });
});
