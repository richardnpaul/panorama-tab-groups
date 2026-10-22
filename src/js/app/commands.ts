import { groupBeside } from '../core/groups.js';
import type { GroupState } from '../ports/group-state.js';
import type { Extension } from '../ports/extension.js';
import type { Logger } from '../ports/logger.js';
import type { OptionsStore } from '../ports/options.js';
import type { Windows } from '../ports/windows.js';

export interface CommandsDeps {
  windows: Pick<Windows, 'currentWindowId'>;
  groupState: Pick<
    GroupState,
    'getGroups' | 'getActiveGroup' | 'setActiveGroup'
  >;
  options: OptionsStore;
  extension: Pick<Extension, 'openOptionsPage'>;
  // Show the tabs of the group, and one of them
  showGroup: (activeGroup: number) => Promise<void>;
  logger: Pick<Logger, 'warn'>;
}

/** The keyboard shortcuts */
export function createCommands({
  windows,
  groupState,
  options,
  extension,
  showGroup,
  logger,
}: CommandsDeps): (command: string) => Promise<void> {
  // Show the group a step from the active one, wrapping round
  async function changeActiveGroupBy(direction: 1 | -1): Promise<void> {
    const windowId = await windows.currentWindowId();
    const target = groupBeside(
      (await groupState.getGroups(windowId)) ?? [],
      await groupState.getActiveGroup(windowId),
      direction,
    );
    if (target === undefined) {
      logger.warn(`No group to change to in window ${String(windowId)}`);
      return;
    }

    await groupState.setActiveGroup(windowId, target.id);
    await showGroup(target.id);
  }

  return async function triggerCommand(command) {
    const { shortcut } = await options.load();
    if (shortcut[command]?.disabled === true) {
      return;
    }

    if (command === 'activate-next-group') {
      await changeActiveGroupBy(1);
    } else if (command === 'activate-previous-group') {
      await changeActiveGroupBy(-1);
    } else if (command === 'manage-extension') {
      await extension.openOptionsPage();
    }
  };
}
