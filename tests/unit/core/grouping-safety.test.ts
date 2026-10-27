import { describe, expect, it } from 'vitest';
import { checkWindowSurvives } from '../../../src/js/core/grouping-safety.js';

describe('core/grouping-safety.ts', () => {
  describe('checkWindowSurvives', () => {
    const VIEW = 'moz-extension://id/view.html';
    const page = (url: string) => ({ url, pendingUrl: undefined });

    it('is not safe when the group is the only tab of the window', () => {
      expect(checkWindowSurvives(1, [page('https://a/')], VIEW)).toEqual({
        safe: false,
        reason: 'Would group only tab in window (window closure risk)',
      });
    });

    it('does not count the view tab as a tab', () => {
      expect(
        checkWindowSurvives(1, [page('https://a/'), page(VIEW)], VIEW),
      ).toEqual({
        safe: false,
        reason: 'Would group only tab in window (window closure risk)',
      });
    });

    it('does not count a tab about to show the view', () => {
      expect(
        checkWindowSurvives(
          1,
          [page('https://a/'), { url: undefined, pendingUrl: VIEW }],
          VIEW,
        ),
      ).toEqual({
        safe: false,
        reason: 'Would group only tab in window (window closure risk)',
      });
    });

    it('is safe when another tab stays outside the group', () => {
      expect(
        checkWindowSurvives(1, [page('https://a/'), page('https://b/')], VIEW),
      ).toEqual({ safe: true });
    });

    it('is safe when several tabs are grouped and they are all there is', () => {
      expect(
        checkWindowSurvives(2, [page('https://a/'), page('https://b/')], VIEW),
      ).toEqual({ safe: true });
    });

    it('is safe when the window has no other tab than one grouped but more are grouped', () => {
      expect(checkWindowSurvives(2, [page('https://a/')], VIEW)).toEqual({
        safe: true,
      });
    });

    it('is safe when there is nothing in the window', () => {
      expect(checkWindowSurvives(0, [], VIEW)).toEqual({ safe: true });
    });
  });
});
