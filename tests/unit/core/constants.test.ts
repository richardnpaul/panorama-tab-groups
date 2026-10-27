import { describe, expect, it } from 'vitest';
import {
  VIEWER_GROUP_ID,
  UNGROUPED_GROUP_ID,
  isReservedGroupId,
  isValidUserGroupId,
} from '../../../src/js/core/constants.js';

describe('constants', () => {
  describe('isReservedGroupId', () => {
    it('returns true for reserved group IDs', () => {
      expect(isReservedGroupId(VIEWER_GROUP_ID)).toBe(true);
      expect(isReservedGroupId(UNGROUPED_GROUP_ID)).toBe(true);
    });

    it('returns false for normal group IDs', () => {
      expect(isReservedGroupId(0)).toBe(false);
      expect(isReservedGroupId(1)).toBe(false);
      expect(isReservedGroupId(100)).toBe(false);
      expect(isReservedGroupId(null)).toBe(false);
      expect(isReservedGroupId(undefined)).toBe(false);
    });
  });

  describe('isValidUserGroupId', () => {
    it('returns true for valid user group IDs', () => {
      expect(isValidUserGroupId(0)).toBe(true);
      expect(isValidUserGroupId(1)).toBe(true);
      expect(isValidUserGroupId(100)).toBe(true);
    });

    it('returns false for reserved or invalid group IDs', () => {
      expect(isValidUserGroupId(VIEWER_GROUP_ID)).toBe(false);
      expect(isValidUserGroupId(UNGROUPED_GROUP_ID)).toBe(false);
      expect(isValidUserGroupId(-3)).toBe(false);
      expect(isValidUserGroupId(null)).toBe(false);
      expect(isValidUserGroupId(undefined)).toBe(false);
      expect(isValidUserGroupId('1')).toBe(false);
    });
  });
});
