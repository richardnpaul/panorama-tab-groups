import { describe, expect, it, vi } from 'vitest';
import { createMemoryGroupState } from '../../../src/js/adapters/memory/group-state.js';
import { createMemoryToolbar } from '../../../src/js/adapters/memory/toolbar.js';
import { createToolbarService } from '../../../src/js/app/toolbar-service.js';
import type { Group } from '../../../src/js/ports/group-state.js';

const group = (id: number, name: string): Group => ({
  id,
  name,
  containerId: 'firefox-default',
  rect: { x: 0, y: 0, w: 1, h: 1 },
});

async function setUp(
  groups: Group[] | null = [group(1, 'Work'), group(2, 'Play')],
) {
  const groupState = createMemoryGroupState();
  if (groups !== null) {
    await groupState.setGroups(3, groups);
  }
  const toolbar = createMemoryToolbar();
  const logger = { warn: vi.fn() };
  return {
    service: createToolbarService({ groupState, toolbar, logger }),
    groupState,
    toolbar,
    logger,
  };
}

describe('app/toolbar-service.ts', () => {
  describe('updateActionTitle', () => {
    it('shows the name of the active group and how many groups there are', async () => {
      const { service, toolbar } = await setUp();

      await service.updateActionTitle(3, 2);

      expect(toolbar.titles.get(3)).toBe('Active Group: Play');
      expect(toolbar.badgeTexts.get(3)).toBe('2');
      expect(toolbar.badgeColor).toBe('#666666');
    });

    it('looks up the active group of the window when it is not given', async () => {
      const { service, toolbar, groupState } = await setUp();
      await groupState.setActiveGroup(3, 1);

      await service.updateActionTitle(3);

      expect(toolbar.titles.get(3)).toBe('Active Group: Work');
    });

    it('uses the given active group, not the stored one', async () => {
      const { service, toolbar, groupState } = await setUp();
      await groupState.setActiveGroup(3, 1);

      await service.updateActionTitle(3, 2);

      expect(toolbar.titles.get(3)).toBe('Active Group: Play');
    });

    it('can show group 0', async () => {
      const { service, toolbar } = await setUp([
        group(0, 'Zero'),
        group(1, 'One'),
      ]);

      await service.updateActionTitle(3, 0);

      expect(toolbar.titles.get(3)).toBe('Active Group: Zero');
    });

    it('says there is none when the active group is not among the groups', async () => {
      const { service, toolbar } = await setUp();

      await service.updateActionTitle(3, 99);

      expect(toolbar.titles.get(3)).toBe('Active Group: None');
      expect(toolbar.badgeTexts.get(3)).toBe('2');
    });

    it('says there is none, and zero groups, when the window has no groups', async () => {
      const { service, toolbar } = await setUp(null);

      await service.updateActionTitle(3, 1);

      expect(toolbar.titles.get(3)).toBe('Active Group: None');
      expect(toolbar.badgeTexts.get(3)).toBe('0');
    });

    it('only shows what belongs to the window it was asked about', async () => {
      const { service, toolbar, groupState } = await setUp();
      await groupState.setGroups(4, [group(7, 'Other')]);

      await service.updateActionTitle(4, 7);

      expect(toolbar.titles.get(4)).toBe('Active Group: Other');
      expect(toolbar.badgeTexts.get(4)).toBe('1');
      expect(toolbar.titles.has(3)).toBe(false);
    });

    it('only warns when the toolbar cannot be updated', async () => {
      const { service, toolbar, logger } = await setUp();
      const failure = new Error('API Error');
      toolbar.failWith(failure);

      await expect(service.updateActionTitle(3, 1)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to set action title/badge:',
        failure,
      );
    });

    it('does not warn when it works', async () => {
      const { service, logger } = await setUp();

      await service.updateActionTitle(3, 1);

      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe('showNoActiveGroup', () => {
    it('shows that no group is active yet, with one group', async () => {
      const { service, toolbar } = await setUp();

      await service.showNoActiveGroup(3);

      expect(toolbar.titles.get(3)).toBe('Active Group: None');
      expect(toolbar.badgeTexts.get(3)).toBe('1');
      expect(toolbar.badgeColor).toBe('#666666');
    });

    it('only warns when the toolbar cannot be updated', async () => {
      const { service, toolbar, logger } = await setUp();
      const failure = new Error('API Error');
      toolbar.failWith(failure);

      await expect(service.showNoActiveGroup(3)).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to set action title/badge:',
        failure,
      );
    });
  });
});
