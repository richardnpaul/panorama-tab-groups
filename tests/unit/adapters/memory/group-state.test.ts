import { describe, expect, it } from 'vitest';
import { createMemoryGroupState } from '../../../../src/js/adapters/memory/group-state.js';
import {
  describeGroupStateContract,
  describeStoredIdsContract,
} from '../../../support/group-state-contract.js';

describeGroupStateContract('memory', createMemoryGroupState);
describeStoredIdsContract('memory', createMemoryGroupState);

describe('adapters/memory/group-state.ts: private windows', () => {
  it('keeps nothing apart, so it lists none, and setting them apart changes nothing', async () => {
    const state = createMemoryGroupState();
    await state.setGroupIndex(3, 1);
    await state.setTabGroup(30, 1);

    await state.setPrivate([3], [30]);

    await expect(state.listPrivateWindowIds()).resolves.toEqual([]);
    await expect(state.listPrivateTabIds()).resolves.toEqual([]);
    await expect(state.listStoredWindowIds()).resolves.toEqual([3]);
    await expect(state.listStoredTabIds()).resolves.toEqual([30]);
  });
});
