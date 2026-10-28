import { describe, expect, it, vi } from 'vitest';
import { createMemoryExtension } from '../../../src/js/adapters/memory/extension.js';
import { createMemoryMessaging } from '../../../src/js/adapters/memory/messaging.js';
import { createMemoryNotifications } from '../../../src/js/adapters/memory/notifications.js';
import { createMemoryToolbar } from '../../../src/js/adapters/memory/toolbar.js';
import { createInitializationUi } from '../../../src/js/app/initialization-ui.js';
import { englishMessage } from '../../support/messages.js';

function setUp() {
  const notifications = createMemoryNotifications();
  const toolbar = createMemoryToolbar();
  const messaging = createMemoryMessaging();
  const logger = { debug: vi.fn() };
  return {
    ui: createInitializationUi({
      notifications,
      toolbar,
      messaging,
      extension: createMemoryExtension(),
      i18n: { getMessage: englishMessage },
      logger,
    }),
    notifications,
    toolbar,
    messaging,
    logger,
  };
}

describe('app/initialization-ui.ts', () => {
  it('is not showing at first', () => {
    expect(setUp().ui.isShowing()).toBe(false);
  });

  describe('show', () => {
    it('shows a notification, an orange badge and tells the view', async () => {
      const env = setUp();

      await env.ui.show();

      expect(env.ui.isShowing()).toBe(true);
      expect(env.notifications.shown.get('viewer-initializing')).toEqual({
        title: 'Tab Groups Viewer',
        message: 'Restoring tab groups...',
        iconUrl: 'moz-extension://id/icons/logo/logo-128.png',
      });
      expect(env.toolbar.defaultBadgeText).toBe('...');
      expect(env.toolbar.badgeColor).toBe('#FF9800');
      expect(env.messaging.sent).toEqual([
        { action: 'showInitializationLoading' },
      ]);
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Loading UI displayed',
      );
    });

    it('does nothing the second time', async () => {
      const env = setUp();
      await env.ui.show();

      await env.ui.show();

      expect(env.messaging.sent).toHaveLength(1);
    });

    it('carries on when the view is not open to be told', async () => {
      const env = setUp();
      env.messaging.fail(new Error('Receiving end does not exist'));

      await env.ui.show();

      expect(env.toolbar.defaultBadgeText).toBe('...');
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Loading UI displayed',
      );
    });
  });

  describe('hide', () => {
    it('clears the notification and badge and tells the view', async () => {
      const env = setUp();
      await env.ui.show();

      await env.ui.hide();

      expect(env.ui.isShowing()).toBe(false);
      expect(env.notifications.shown.size).toBe(0);
      expect(env.toolbar.defaultBadgeText).toBe('');
      expect(env.messaging.sent.at(-1)).toEqual({
        action: 'hideInitializationLoading',
      });
      expect(env.logger.debug).toHaveBeenCalledWith(
        '[Initialization] Loading UI hidden',
      );
    });

    it('does nothing when nothing is shown', async () => {
      const env = setUp();

      await env.ui.hide();

      expect(env.messaging.sent).toEqual([]);
      expect(env.toolbar.defaultBadgeText).toBeUndefined();
      expect(env.logger.debug).not.toHaveBeenCalled();
    });

    it('carries on when the view is not open to be told', async () => {
      const env = setUp();
      await env.ui.show();
      env.messaging.fail(new Error('Receiving end does not exist'));

      await env.ui.hide();

      expect(env.ui.isShowing()).toBe(false);
    });

    it('can be shown again after', async () => {
      const env = setUp();
      await env.ui.show();
      await env.ui.hide();

      await env.ui.show();

      expect(env.ui.isShowing()).toBe(true);
      expect(env.notifications.shown.size).toBe(1);
    });
  });
});
