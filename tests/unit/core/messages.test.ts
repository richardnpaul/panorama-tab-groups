import { describe, expect, it } from 'vitest';
import {
  openEnvelope,
  parseGroupDeletion,
  parseOpeningBackup,
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
});
