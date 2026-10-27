import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  installPolyfills,
  type PolyfillScope,
  type PolyfillTarget,
} from '../../src/js/polyfill.js';
import { createFakeLocks } from '../support/fake-locks.js';
import { createFakeStorage } from '../support/fake-storage.js';

const target = (extra: Partial<PolyfillTarget> = {}): PolyfillTarget => ({
  storage: { local: createFakeStorage().area },
  ...extra,
});

const SESSION_METHODS = [
  'getTabValue',
  'setTabValue',
  'removeTabValue',
  'getWindowValue',
  'setWindowValue',
  'removeWindowValue',
] as const;

describe('polyfill.ts', () => {
  describe('the browser object', () => {
    it('is chrome where there is no browser', () => {
      const chrome = target();
      const scope: PolyfillScope = { chrome };

      installPolyfills(scope);

      expect(scope.browser).toBe(chrome);
    });

    it('stays as it is where there is a browser, even if there is a chrome too', () => {
      const browser = target();
      const scope: PolyfillScope = { browser, chrome: target() };

      installPolyfills(scope);

      expect(scope.browser).toBe(browser);
    });

    it('stays empty where there is neither', () => {
      const scope: PolyfillScope = {};

      installPolyfills(scope);

      expect(scope.browser).toBeUndefined();
    });

    it('prepares the browser that chrome turned into', () => {
      const chrome = target();

      installPolyfills({ chrome });

      expect(chrome.sessions).toBeDefined();
    });
  });

  describe('sessions, kept under the locks of the extension where there are any', () => {
    it('takes the lock for every read and write', async () => {
      const fake = createFakeLocks();
      const browser = target();

      installPolyfills({ browser, navigator: { locks: fake.locks } });
      await browser.sessions?.setTabValue?.(1, 'groupId', 'two');
      await browser.sessions?.getTabValue?.(1, 'groupId');

      expect(fake.requests).toEqual(['tgv-sessions', 'tgv-sessions']);
    });

    it('works without locks', async () => {
      const browser = target();

      installPolyfills({ browser, navigator: {} });
      await browser.sessions?.setTabValue?.(1, 'groupId', 'two');

      await expect(browser.sessions?.getTabValue?.(1, 'groupId')).resolves.toBe(
        'two',
      );
    });
  });

  describe('sessions', () => {
    it('adds all six session methods where the browser has none', () => {
      const browser = target();

      installPolyfills({ browser });

      SESSION_METHODS.forEach((method) => {
        expect(browser.sessions?.[method]).toBeTypeOf('function');
      });
    });

    it('adds them to the sessions object the browser has, not to a new one', () => {
      const sessions = {};
      const browser = target({ sessions });

      installPolyfills({ browser });

      expect(browser.sessions).toBe(sessions);
      expect(Object.keys(sessions).sort()).toEqual([...SESSION_METHODS].sort());
    });

    it.each(SESSION_METHODS)('keeps the browser’s own %s', (method) => {
      const own = vi.fn();
      const browser = target({ sessions: { [method]: own } });

      installPolyfills({ browser });

      expect(browser.sessions?.[method]).toBe(own);
      SESSION_METHODS.filter((other) => other !== method).forEach((other) => {
        expect(browser.sessions?.[other]).not.toBe(own);
        expect(browser.sessions?.[other]).toBeTypeOf('function');
      });
    });

    it('leaves a browser that has all of them alone', () => {
      const own = Object.fromEntries(
        SESSION_METHODS.map((method) => [method, vi.fn()]),
      );
      const browser = target({ sessions: { ...own } });

      installPolyfills({ browser });

      SESSION_METHODS.forEach((method) => {
        expect(browser.sessions?.[method]).toBe(own[method]);
      });
    });

    it('keeps the values in the extension storage of the browser', async () => {
      const { area, data } = createFakeStorage();
      const browser = target({ storage: { local: area } });
      installPolyfills({ browser });

      await browser.sessions?.setTabValue?.(7, 'groupId', '3');
      await browser.sessions?.setWindowValue?.(2, 'activeGroup', '5');

      expect(data.get('__mock_sessions')).toEqual({
        tabs: { 7: { groupId: '3' } },
        windows: { 2: { activeGroup: '5' } },
      });
      await expect(browser.sessions?.getTabValue?.(7, 'groupId')).resolves.toBe(
        '3',
      );
      await expect(
        browser.sessions?.getWindowValue?.(2, 'activeGroup'),
      ).resolves.toBe('5');
    });

    it('can also remove them', async () => {
      const browser = target();
      installPolyfills({ browser });
      await browser.sessions?.setTabValue?.(1, 'k', 'v');
      await browser.sessions?.setWindowValue?.(1, 'k', 'v');

      await browser.sessions?.removeTabValue?.(1, 'k');
      await browser.sessions?.removeWindowValue?.(1, 'k');

      await expect(
        browser.sessions?.getTabValue?.(1, 'k'),
      ).resolves.toBeUndefined();
      await expect(
        browser.sessions?.getWindowValue?.(1, 'k'),
      ).resolves.toBeUndefined();
    });

    it('uses the storage the browser has when a value is stored', async () => {
      const first = createFakeStorage();
      const second = createFakeStorage();
      const browser = target({ storage: { local: first.area } });
      installPolyfills({ browser });

      browser.storage.local = second.area;
      await browser.sessions?.setTabValue?.(1, 'k', 'v');

      expect(first.data.size).toBe(0);
      expect(second.data.size).toBe(1);
    });
  });

  describe('the toolbar button', () => {
    const withAction = (
      setTitle: PolyfillTarget['action'] extends infer A
        ? A extends { setTitle: infer F }
          ? F
          : never
        : never,
    ) => {
      const setBadgeText = vi.fn().mockResolvedValue(undefined);
      const action = { setTitle, setBadgeText };
      return { browser: target({ action }), action, setBadgeText };
    };

    it('passes calls on as they are when they work', async () => {
      const setTitle = vi.fn().mockResolvedValue(undefined);
      const { browser, setBadgeText } = withAction(setTitle);
      installPolyfills({ browser });

      await browser.action?.setTitle({ title: 'T', windowId: 2 });
      await browser.action?.setBadgeText({ text: '3', windowId: 2 });

      expect(setTitle).toHaveBeenCalledWith({ title: 'T', windowId: 2 });
      expect(setBadgeText).toHaveBeenCalledWith({ text: '3', windowId: 2 });
    });

    it('tries again without the window where the browser refuses a window id', async () => {
      const setTitle = vi
        .fn()
        .mockRejectedValueOnce(new Error('windowId not supported'))
        .mockResolvedValueOnce(undefined);
      const { browser } = withAction(setTitle);
      installPolyfills({ browser });

      await browser.action?.setTitle({ title: 'T', tabId: 4, windowId: 2 });

      expect(setTitle).toHaveBeenNthCalledWith(2, { title: 'T', tabId: 4 });
    });

    it('does the same for the badge text', async () => {
      const { browser, setBadgeText } = withAction(
        vi.fn().mockResolvedValue(undefined),
      );
      setBadgeText
        .mockRejectedValueOnce(new Error('windowId not supported'))
        .mockResolvedValueOnce(undefined);
      installPolyfills({ browser });

      await browser.action?.setBadgeText({ text: '3', windowId: 2 });

      expect(setBadgeText).toHaveBeenCalledTimes(2);
      expect(setBadgeText).toHaveBeenNthCalledWith(2, { text: '3' });
    });

    it('passes on a failure that has nothing to do with the window', async () => {
      const failure = new Error('broken');
      const setTitle = vi.fn().mockRejectedValue(failure);
      const { browser } = withAction(setTitle);
      installPolyfills({ browser });

      await expect(browser.action?.setTitle({ title: 'T' })).rejects.toBe(
        failure,
      );
      expect(setTitle).toHaveBeenCalledTimes(1);
    });

    it('calls the original on the action object', async () => {
      const setTitle = vi.fn().mockResolvedValue(undefined);
      const { browser, action } = withAction(setTitle);
      installPolyfills({ browser });

      await browser.action?.setTitle({ title: 'T' });

      expect(setTitle.mock.contexts[0]).toBe(action);
    });

    it('does not mind a browser without a toolbar button', () => {
      const browser = target();

      expect(() => {
        installPolyfills({ browser });
      }).not.toThrow();
      expect(browser.action).toBeUndefined();
    });
  });

  describe('when it is loaded', () => {
    afterEach(() => {
      Reflect.deleteProperty(globalThis, 'browser');
      Reflect.deleteProperty(globalThis, 'chrome');
    });

    it('turns the global chrome into the global browser', async () => {
      vi.resetModules();
      Reflect.deleteProperty(globalThis, 'browser');
      const chrome = target();
      Object.assign(globalThis, { chrome });

      await import('../../src/js/polyfill.js');

      expect(Reflect.get(globalThis, 'browser')).toBe(chrome);
      expect(chrome.sessions?.setTabValue).toBeTypeOf('function');
    });

    it('leaves the global browser in place where there is one', async () => {
      vi.resetModules();
      const browser = target();
      Object.assign(globalThis, { browser });

      await import('../../src/js/polyfill.js');

      expect(Reflect.get(globalThis, 'browser')).toBe(browser);
      expect(browser.sessions?.getTabValue).toBeTypeOf('function');
    });

    it('does nothing without a browser or chrome', async () => {
      vi.resetModules();
      Reflect.deleteProperty(globalThis, 'browser');

      await import('../../src/js/polyfill.js');

      expect(Reflect.get(globalThis, 'browser')).toBeUndefined();
    });
  });
});
