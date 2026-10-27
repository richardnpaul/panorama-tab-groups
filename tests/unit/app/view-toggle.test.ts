import { describe, expect, it } from 'vitest';
import { createMemoryClock } from '../../../src/js/adapters/memory/clock.js';
import { createMemoryExtension } from '../../../src/js/adapters/memory/extension.js';
import { createMemoryScheduler } from '../../../src/js/adapters/memory/scheduler.js';
import { createMemoryTabs } from '../../../src/js/adapters/memory/tabs.js';
import { createMemoryWindows } from '../../../src/js/adapters/memory/windows.js';
import { createViewOpening } from '../../../src/js/app/view-opening.js';
import { createViewToggle } from '../../../src/js/app/view-toggle.js';
import type { TabDetails } from '../../../src/js/ports/tabs.js';

const WINDOW = 2;
const VIEW = 'moz-extension://id/view.html';

const tab = (id: number, overrides: Partial<TabDetails> = {}): TabDetails => ({
  id,
  windowId: WINDOW,
  active: false,
  pinned: false,
  url: `https://site${String(id)}/`,
  pendingUrl: undefined,
  title: undefined,
  browserGroupId: undefined,
  ...overrides,
});

function setUp(tabList: TabDetails[], summaries?: Record<number, number>) {
  const tabs = createMemoryTabs();
  tabs.setDetails(tabList);
  tabs.openWindowId = WINDOW;
  if (summaries !== undefined) {
    tabs.setTabs(
      Object.entries(summaries).map(([id, lastAccessed]) => ({
        id: Number(id),
        pinned: false,
        lastAccessed,
      })),
    );
  }
  const viewOpening = createViewOpening({
    clock: createMemoryClock(1000),
    scheduler: createMemoryScheduler(),
    logger: { debug: () => undefined, warn: () => undefined },
  });
  return {
    toggleView: createViewToggle({
      tabs,
      windows: createMemoryWindows(WINDOW),
      extension: createMemoryExtension(),
      viewOpening,
    }),
    tabs,
    viewOpening,
  };
}

describe('app/view-toggle.ts', () => {
  describe('when the window has no view tab', () => {
    it('opens one and makes it the active tab', async () => {
      const env = setUp([tab(1, { active: true })]);

      await env.toggleView();

      expect(env.tabs.calls).toEqual(['open /view.html']);
      expect((await env.tabs.listInWindow(WINDOW)).at(-1)).toMatchObject({
        url: '/view.html',
        active: true,
      });
    });

    it('is waiting for the tab in the window while it opens, and knows which when it has', async () => {
      const env = setUp([tab(1, { active: true })]);

      await env.toggleView();

      expect(env.viewOpening.current()).toEqual({
        tabId: 9000,
        windowId: WINDOW,
        creationTimestamp: 1000,
      });
    });

    it('is waiting before the tab is opened, so a tab announced early is known', async () => {
      const env = setUp([tab(1, { active: true })]);
      let waitingWhenOpened: unknown = 'never opened';
      const open = env.tabs.open.bind(env.tabs);
      env.tabs.open = (url, active) => {
        waitingWhenOpened = structuredClone(env.viewOpening.current());
        return open(url, active);
      };

      await env.toggleView();

      expect(waitingWhenOpened).toEqual({
        tabId: null,
        windowId: WINDOW,
        creationTimestamp: 1000,
      });
    });

    it('does not take a tab of another window for the view', async () => {
      const env = setUp([
        tab(1, { active: true }),
        tab(5, { windowId: 9, url: VIEW }),
      ]);

      await env.toggleView();

      expect(env.tabs.calls).toEqual(['open /view.html']);
    });

    it('does not take a tab for the view for showing a page that only starts like it', async () => {
      const env = setUp([
        tab(1, { active: true, url: `${VIEW}?x=1` }),
        tab(2, { url: 'https://example.com/' }),
      ]);

      await env.toggleView();

      expect(env.tabs.calls).toEqual(['open /view.html']);
    });
  });

  describe('when the window has a view tab', () => {
    it('goes to it from another tab', async () => {
      const env = setUp([tab(1, { active: true }), tab(7, { url: VIEW })]);

      await env.toggleView();

      expect(env.tabs.calls).toEqual(['activate 7']);
      expect(env.viewOpening.current()).toBeNull();
    });

    it('goes back to the tab used last when the view is the active tab', async () => {
      const env = setUp([tab(1), tab(2), tab(7, { url: VIEW, active: true })], {
        1: 100,
        2: 300,
        7: 900,
      });

      await env.toggleView();

      expect(env.tabs.calls).toEqual(['activate 2']);
    });

    it('stays where it is when the view is the only tab', async () => {
      const env = setUp([tab(7, { url: VIEW, active: true })], { 7: 900 });

      await env.toggleView();

      expect(env.tabs.calls).toEqual([]);
    });
  });
});
