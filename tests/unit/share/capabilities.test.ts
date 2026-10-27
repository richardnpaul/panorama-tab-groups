import { describe, expect, it } from 'vitest';
import {
  browserModeOf,
  detectCapabilities,
} from '../../../src/js/share/capabilities.js';

const fn = () => undefined;

describe('share/capabilities.ts', () => {
  describe('detectCapabilities', () => {
    it('finds tab hiding when tabs.hide exists', () => {
      expect(detectCapabilities({ tabs: { hide: fn } }).hasTabHide).toBe(true);
    });

    it('does not find tab hiding without tabs.hide', () => {
      expect(detectCapabilities({ tabs: {} }).hasTabHide).toBe(false);
      expect(detectCapabilities({ tabs: { hide: undefined } }).hasTabHide).toBe(
        false,
      );
      expect(detectCapabilities({}).hasTabHide).toBe(false);
    });

    it('counts any defined tabs.hide as tab hiding, whatever its type', () => {
      expect(detectCapabilities({ tabs: { hide: null } }).hasTabHide).toBe(
        true,
      );
    });

    it('finds tab groups when tabGroups.query and tabs.group are functions', () => {
      const api = { tabGroups: { query: fn }, tabs: { group: fn } };

      expect(detectCapabilities(api).hasTabGroups).toBe(true);
    });

    it.each([
      ['there is no tabGroups', { tabs: { group: fn } }],
      ['tabGroups has no query', { tabGroups: {}, tabs: { group: fn } }],
      [
        'tabGroups.query is not a function',
        { tabGroups: { query: 'x' }, tabs: { group: fn } },
      ],
      ['there is no tabs', { tabGroups: { query: fn } }],
      ['tabs has no group', { tabGroups: { query: fn }, tabs: {} }],
      [
        'tabs.group is not a function',
        { tabGroups: { query: fn }, tabs: { group: 1 } },
      ],
      ['there is nothing', {}],
    ])('does not find tab groups when %s', (_name, api) => {
      expect(detectCapabilities(api).hasTabGroups).toBe(false);
    });

    it('reports the two capabilities independently', () => {
      expect(
        detectCapabilities({
          tabGroups: { query: fn },
          tabs: { group: fn, hide: fn },
        }),
      ).toEqual({ hasTabHide: true, hasTabGroups: true });
      expect(detectCapabilities({ tabs: { hide: fn } })).toEqual({
        hasTabHide: true,
        hasTabGroups: false,
      });
    });
  });

  describe('browserModeOf', () => {
    it.each([
      [true, true, 'hybrid'],
      [false, true, 'collapse-only'],
      [true, false, 'legacy'],
      [false, false, 'unsupported'],
    ])(
      'tab hide %s and tab groups %s is %s',
      (hasTabHide, hasTabGroups, mode) => {
        expect(browserModeOf({ hasTabHide, hasTabGroups })).toBe(mode);
      },
    );
  });
});
