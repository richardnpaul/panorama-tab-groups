import { describe, expect, it } from 'vitest';
import {
  fallbackActiveGroup,
  isViewerTab,
  VIEW_TAB_WINDOW_MS,
} from '../../../src/js/core/tab-assignment.js';

const VIEW = 'moz-extension://id/view.html';

const check = (
  overrides: {
    tab?: Partial<{
      id: number;
      windowId: number;
      url: string | undefined;
      pendingUrl: string | undefined;
    }>;
    opening?: {
      tabId: number;
      windowId: number;
      creationTimestamp: number;
    } | null;
    now?: number;
  } = {},
) =>
  isViewerTab({
    tab: {
      id: 10,
      windowId: 1,
      url: 'https://example.com/',
      pendingUrl: undefined,
      ...overrides.tab,
    },
    viewUrl: VIEW,
    opening: overrides.opening ?? null,
    now: overrides.now ?? 1000,
  });

describe('core/tab-assignment.ts', () => {
  describe('isViewerTab', () => {
    it('is false for an ordinary tab when no view was asked for', () => {
      expect(check()).toBe(false);
    });

    it('is true for a tab showing the view page', () => {
      expect(check({ tab: { url: VIEW } })).toBe(true);
    });

    it('is true for a tab about to show the view page', () => {
      expect(check({ tab: { url: undefined, pendingUrl: VIEW } })).toBe(true);
    });

    it('is true for the tab that was asked for', () => {
      expect(
        check({
          opening: { tabId: 10, windowId: 9, creationTimestamp: 0 },
        }),
      ).toBe(true);
    });

    it('is false for another tab in another window than the one asked for', () => {
      expect(
        check({
          opening: { tabId: 11, windowId: 9, creationTimestamp: 999 },
        }),
      ).toBe(false);
    });

    it('is true for a tab that appears in that window just after', () => {
      expect(
        check({
          opening: { tabId: 11, windowId: 1, creationTimestamp: 1000 - 99 },
        }),
      ).toBe(true);
    });

    it('is true for a tab that appears in that window at the same moment', () => {
      expect(
        check({ opening: { tabId: 11, windowId: 1, creationTimestamp: 1000 } }),
      ).toBe(true);
    });

    it('is false for a tab that appears in that window too long after', () => {
      expect(
        check({
          opening: {
            tabId: 11,
            windowId: 1,
            creationTimestamp: 1000 - VIEW_TAB_WINDOW_MS,
          },
        }),
      ).toBe(false);
    });

    it('is true for the view tab however long after it was asked for', () => {
      expect(
        check({
          opening: { tabId: 10, windowId: 1, creationTimestamp: 1 },
        }),
      ).toBe(true);
    });

    it('treats the time of a view asked for at the very start as a time', () => {
      expect(
        check({
          now: 50,
          opening: { tabId: 11, windowId: 1, creationTimestamp: 0 },
        }),
      ).toBe(true);
    });
  });

  describe('fallbackActiveGroup', () => {
    it('is the lowest numbered group', () => {
      expect(fallbackActiveGroup([{ id: 5 }, { id: 2 }, { id: 9 }])).toBe(2);
    });

    it('ignores the reserved groups', () => {
      expect(fallbackActiveGroup([{ id: -2 }, { id: -1 }, { id: 4 }])).toBe(4);
    });

    it('is the first group when there are no groups', () => {
      expect(fallbackActiveGroup([])).toBe(0);
    });

    it('is the first group when groups were never stored', () => {
      expect(fallbackActiveGroup(undefined)).toBe(0);
    });

    it('is the first group when it is the only one', () => {
      expect(fallbackActiveGroup([{ id: 0 }])).toBe(0);
    });
  });
});
