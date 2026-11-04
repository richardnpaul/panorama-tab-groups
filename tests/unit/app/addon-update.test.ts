import { describe, expect, it, vi } from 'vitest';
import { createMemoryExtension } from '../../../src/js/adapters/memory/extension.js';
import { createMemoryPendingUpdate } from '../../../src/js/adapters/memory/pending-update.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createAddonUpdate } from '../../../src/js/app/addon-update.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';

const tab = (id: number, url: string): TabDetails => ({
  id,
  windowId: 1,
  active: false,
  pinned: false,
  url,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
});

function setUp(pages: TabDetails[] = []) {
  const order: string[] = [];
  const tabs = createMemoryTabs();
  tabs.setDetails([tab(1, 'https://example.test/'), ...pages]);
  const extension = createMemoryExtension('moz-extension://id/');
  vi.spyOn(extension, 'reload').mockImplementation(() => {
    order.push('reload');
    extension.reloads += 1;
  });
  const autoBackup = {
    writeNow: vi.fn((reason: string) => {
      order.push(`backup (${reason})`);
      return Promise.resolve(true);
    }),
  };
  const logger = { debug: vi.fn(), error: vi.fn() };
  const pendingUpdate = createMemoryPendingUpdate();
  const make = () =>
    createAddonUpdate({
      autoBackup,
      tabs,
      extension,
      pendingUpdate,
      logger,
    });
  return {
    update: make(),
    // The background as a fresh one has it, after the old was unloaded: it remembers nothing
    unloaded: make,
    tabs,
    extension,
    autoBackup,
    pendingUpdate,
    logger,
    order,
  };
}

describe('app/addon-update.ts', () => {
  it('backs up at once, then starts again with the new version when none of its pages is open', async () => {
    const env = setUp();

    await env.update.updateAvailable();

    expect(env.order).toEqual(['backup (update)', 'reload']);
  });

  it('starts again even when the backup could not be written', async () => {
    const env = setUp();
    env.autoBackup.writeNow.mockResolvedValue(false);

    await env.update.updateAvailable();

    expect(env.extension.reloads).toBe(1);
  });

  it('waits while a page of the add-on is open, which starting again would end', async () => {
    const env = setUp([
      tab(2, 'moz-extension://id/view.html'),
      tab(3, 'moz-extension://id/options.html'),
    ]);

    await env.update.updateAvailable();

    expect(env.extension.reloads).toBe(0);
    expect(env.logger.debug).toHaveBeenCalledWith(
      '[Update] Waiting for 2 page(s) of the add-on to close',
    );

    // One closed: the other still holds it back
    env.tabs.setDetails([tab(3, 'moz-extension://id/options.html')]);
    await env.update.tabRemoved(2);
    expect(env.extension.reloads).toBe(0);

    // The last, which the browser may still list as it goes
    await env.update.tabRemoved(3);
    expect(env.extension.reloads).toBe(1);
  });

  it('starts again only once', async () => {
    const env = setUp([tab(2, 'moz-extension://id/view.html')]);
    await env.update.updateAvailable();
    env.tabs.setDetails([]);

    await env.update.tabRemoved(2);
    await env.update.tabRemoved(5);

    expect(env.extension.reloads).toBe(1);
  });

  it('takes no notice of tabs closed while no update is waiting', async () => {
    const env = setUp();
    const query = vi.spyOn(env.tabs, 'idsOfAddressesUnder');

    await env.update.tabRemoved(1);

    expect(query).not.toHaveBeenCalled();
    expect(env.extension.reloads).toBe(0);
  });

  it('looks for the pages under the address of the add-on', async () => {
    const env = setUp();
    const query = vi.spyOn(env.tabs, 'idsOfAddressesUnder');

    await env.update.updateAvailable();

    expect(query).toHaveBeenCalledWith('moz-extension://id/');
  });

  it('logs, and does not start again, when it cannot tell which pages are open', async () => {
    const env = setUp();
    const failure = new Error('no tabs');
    vi.spyOn(env.tabs, 'idsOfAddressesUnder').mockRejectedValue(failure);

    await env.update.updateAvailable();
    await env.update.tabRemoved(1);

    expect(env.extension.reloads).toBe(0);
    expect(env.logger.error.mock.calls).toEqual([
      ['[Update] Could not go on with the update:', failure],
      ['[Update] Could not go on with the update:', failure],
    ]);
  });

  describe('the background being unloaded while an update waits for a page to close', () => {
    it('is remembered by a fresh background, which starts again once the page is closed', async () => {
      const env = setUp([tab(2, 'moz-extension://id/view.html')]);
      await env.update.updateAvailable();
      expect(env.extension.reloads).toBe(0);
      expect(await env.pendingUpdate.isPending()).toBe(true);

      const fresh = env.unloaded();
      env.tabs.setDetails([tab(1, 'https://example.test/')]);
      await fresh.tabRemoved(2);

      expect(env.extension.reloads).toBe(1);
      expect(await env.pendingUpdate.isPending()).toBe(false);
    });

    it('is not remembered when no update waits: a fresh background starts nothing', async () => {
      const env = setUp();

      await env.unloaded().tabRemoved(2);

      expect(env.extension.reloads).toBe(0);
    });

    it('does not start again before the backup is over, whatever page is closed meanwhile', async () => {
      const env = setUp([tab(2, 'moz-extension://id/view.html')]);
      let finish: () => void = () => undefined;
      env.autoBackup.writeNow.mockImplementation(
        () =>
          new Promise<boolean>((resolve) => {
            finish = () => {
              resolve(true);
            };
          }),
      );

      const updating = env.update.updateAvailable();
      await Promise.resolve();
      env.tabs.setDetails([tab(1, 'https://example.test/')]);
      await env.update.tabRemoved(2);
      expect(env.extension.reloads).toBe(0);

      finish();
      await updating;
      expect(env.extension.reloads).toBe(1);
    });

    it('starts again, and says so, when the update could not be remembered or forgotten', async () => {
      const env = setUp();
      const failure = new Error('no session storage');
      env.pendingUpdate.failWith(failure);

      await env.update.updateAvailable();

      expect(env.extension.reloads).toBe(1);
      expect(env.logger.error).toHaveBeenCalledWith(
        '[Update] The update could not be remembered:',
        failure,
      );
      expect(env.logger.error).toHaveBeenCalledWith(
        '[Update] The pending update could not be cleared:',
        failure,
      );
    });

    it('goes on from what it holds itself when the browser cannot keep the update for it', async () => {
      const env = setUp([tab(2, 'moz-extension://id/view.html')]);
      env.pendingUpdate.failWith(new Error('no session storage'));
      await env.update.updateAvailable();
      expect(env.extension.reloads).toBe(0);
      env.tabs.setDetails([]);

      await env.update.tabRemoved(2);

      expect(env.extension.reloads).toBe(1);
    });

    it('says so when it cannot tell whether an update waits', async () => {
      const env = setUp();
      const failure = new Error('no session storage');
      env.pendingUpdate.failWith(failure);

      await env.update.tabRemoved(2);

      expect(env.logger.error).toHaveBeenCalledWith(
        '[Update] Could not go on with the update:',
        failure,
      );
    });
  });
});
