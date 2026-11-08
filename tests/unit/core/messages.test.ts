import { describe, expect, it } from 'vitest';
import {
  openEnvelope,
  parseGroupDeletion,
  parseMenuChange,
  parseOpeningBackup,
  parseTabPlacement,
  isSuccess,
} from '../../../src/js/core/messages.js';

const valid = {
  action: 'deleteGroup',
  groupId: 3,
  windowId: 7,
  nativeGroupId: 55,
  tabIds: [1, 2],
};

describe('core/messages.ts', () => {
  describe('parseGroupDeletion', () => {
    it('reads what the view sends', () => {
      expect(parseGroupDeletion(valid)).toEqual({
        groupId: 3,
        windowId: 7,
        nativeGroupId: 55,
        tabIds: [1, 2],
      });
    });

    it('leaves out what it does not need', () => {
      expect(parseGroupDeletion({ ...valid, extra: true })).toStrictEqual({
        groupId: 3,
        windowId: 7,
        nativeGroupId: 55,
        tabIds: [1, 2],
      });
    });

    it.each([[null], [undefined]])(
      'accepts the native group %s, for a group that never had one',
      (nativeGroupId) => {
        expect(
          parseGroupDeletion({ ...valid, nativeGroupId })?.nativeGroupId,
        ).toBe(nativeGroupId);
      },
    );

    it('accepts a message with no native group at all', () => {
      const { nativeGroupId, ...without } = valid;

      expect(nativeGroupId).toBe(55);
      expect(parseGroupDeletion(without)).toEqual({
        groupId: 3,
        windowId: 7,
        nativeGroupId: undefined,
        tabIds: [1, 2],
      });
    });

    it('accepts the ids 0 and negative ones, and a group with no tabs', () => {
      expect(
        parseGroupDeletion({ ...valid, groupId: 0, windowId: 0, tabIds: [] }),
      ).toMatchObject({ groupId: 0, windowId: 0, tabIds: [] });
      expect(parseGroupDeletion({ ...valid, groupId: -2 })?.groupId).toBe(-2);
    });

    it.each([
      ['groupId', '3'],
      ['groupId', 1.5],
      ['groupId', Number.NaN],
      ['groupId', undefined],
      ['windowId', '7'],
      ['windowId', undefined],
      ['nativeGroupId', '55'],
      ['nativeGroupId', 1.5],
      ['tabIds', undefined],
      ['tabIds', 'abc'],
      ['tabIds', [1, '2']],
      ['tabIds', [1, 1.5]],
    ])('refuses %s being %j', (key, value) => {
      expect(parseGroupDeletion({ ...valid, [key]: value })).toBeUndefined();
    });
  });

  describe('parseTabPlacement', () => {
    const asked = { tabId: 11, groupId: 0, windowId: 1 };

    it('reads a tab dropped in a group', () => {
      expect(parseTabPlacement(asked)).toEqual({ ...asked, beside: undefined });
    });

    it('reads a tab dropped next to another, before or after it', () => {
      expect(
        parseTabPlacement({ ...asked, beside: { tabId: 12, before: false } }),
      ).toEqual({ ...asked, beside: { tabId: 12, before: false } });
    });

    it('keeps nothing else of what it is given next to', () => {
      expect(
        parseTabPlacement({
          ...asked,
          beside: { tabId: 12, before: true, extra: 1 },
        })?.beside,
      ).toEqual({ tabId: 12, before: true });
    });

    it.each([
      [{ groupId: 0, windowId: 1 }],
      [{ tabId: 11, windowId: 1 }],
      [{ tabId: 11, groupId: 0 }],
      [{ ...asked, tabId: 1.5 }],
      [{ ...asked, groupId: '0' }],
      [{ ...asked, windowId: null }],
      [{ ...asked, beside: 12 }],
      [{ ...asked, beside: { tabId: '12', before: true } }],
      [{ ...asked, beside: { tabId: 12 } }],
      [{ ...asked, beside: null }],
    ])('refuses %j', (message) => {
      expect(parseTabPlacement(message)).toBeUndefined();
    });
  });

  describe('isSuccess', () => {
    it('is true for an answer that says it succeeded', () => {
      expect(isSuccess({ success: true })).toBe(true);
    });

    it.each([
      [{ success: false }],
      [{ success: 'true' }],
      [{}],
      [undefined],
      ['ok'],
    ])('is false for %j', (answer) => {
      expect(isSuccess(answer)).toBe(false);
    });
  });

  describe('parseOpeningBackup', () => {
    it.each([[true], [false]])('reads %s', (value) => {
      expect(parseOpeningBackup({ key: 'openingBackup', value })).toBe(value);
    });

    it.each([
      [{ key: 'openingBackup', value: 'yes' }],
      [{ key: 'openingBackup' }],
      [{ key: 'openingView', value: true }],
      [{ value: true }],
    ])('refuses %j', (message) => {
      expect(parseOpeningBackup(message)).toBeUndefined();
    });
  });

  describe('openEnvelope', () => {
    it('is the action and the message', () => {
      const message = { action: 'refreshView', other: 1 };

      const envelope = openEnvelope(message);

      expect(envelope?.action).toBe('refreshView');
      expect(envelope?.message).toBe(message);
    });

    it.each([[undefined], [null], ['refreshView'], [3], [{}], [{ action: 3 }]])(
      'is nothing for %j',
      (message) => {
        expect(openEnvelope(message)).toBeUndefined();
      },
    );
  });

  describe('parseMenuChange', () => {
    it.each(['createMenuItem', 'updateMenuItem'] as const)(
      'reads a %s message and leaves out extra fields',
      (action) => {
        expect(
          parseMenuChange({
            action,
            windowId: 1,
            groupId: 2,
            groupName: 'Work',
            extra: true,
          }),
        ).toStrictEqual({
          action,
          windowId: 1,
          groupId: 2,
          groupName: 'Work',
        });
      },
    );

    it('reads a removeMenuItem message and leaves out extra fields', () => {
      expect(
        parseMenuChange({
          action: 'removeMenuItem',
          windowId: 1,
          groupId: 2,
          extra: true,
        }),
      ).toStrictEqual({
        action: 'removeMenuItem',
        windowId: 1,
        groupId: 2,
      });
    });

    it.each([
      [{ action: 'createMenuItem', windowId: '1', groupId: 2, groupName: 'A' }],
      [{ action: 'createMenuItem', windowId: 1.5, groupId: 2, groupName: 'A' }],
      [{ action: 'createMenuItem', windowId: 1, groupId: '2', groupName: 'A' }],
      [{ action: 'createMenuItem', windowId: 1, groupId: 1.5, groupName: 'A' }],
      [{ action: 'createMenuItem', windowId: 1, groupId: 2, groupName: 99 }],
      [{ action: 'updateMenuItem', windowId: 1, groupId: 2 }],
      [{ action: 'removeMenuItem', windowId: '1', groupId: 2 }],
      [{ action: 'removeMenuItem', windowId: 1, groupId: '2' }],
      [{ action: 'otherAction', windowId: 1, groupId: 2, groupName: 'A' }],
    ])('refuses %j', (message) => {
      expect(parseMenuChange(message)).toBeUndefined();
    });
  });
});
