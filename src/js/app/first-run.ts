import { isReservedGroupId } from '../core/constants.js';
import type { GroupState } from '../ports/group-state.js';
import type { Logger } from '../ports/logger.js';
import type { OptionsStore } from '../ports/options.js';
import type { Tabs } from '../ports/tabs.js';
import type { Windows } from '../ports/windows.js';
import type { Capabilities } from '../share/capabilities.js';

export interface FirstRunDeps {
  options: Pick<OptionsStore, 'isSet' | 'save'>;
  windows: Pick<Windows, 'listIds'>;
  tabs: Pick<Tabs, 'listInWindow'>;
  groupState: Pick<GroupState, 'getGroups'>;
  capabilities: Capabilities;
  logger: Pick<Logger, 'debug'>;
}

export interface FirstRun {
  /**
   * The first time the add-on runs, and no choice about native tab groups was made
   * yet, decide it once: on where there is nothing to move into them, off where there
   * is. It is stored, so it is not decided again.
   */
  decideNativeGroups: () => Promise<void>;
}

export function createFirstRun({
  options,
  windows,
  tabs,
  groupState,
  capabilities,
  logger,
}: FirstRunDeps): FirstRun {
  // Groups of this add-on are kept from an earlier version, or a window has tabs
  // that nothing has grouped yet: turning native groups on would change how all of
  // those look, and without being asked
  async function hasSomethingToKeep(): Promise<boolean> {
    const found = await Promise.all(
      (await windows.listIds()).map(async (windowId) => {
        const groups = (await groupState.getGroups(windowId)) ?? [];
        if (groups.some(({ id }) => !isReservedGroupId(id))) {
          return true;
        }
        return (await tabs.listInWindow(windowId)).length > 1;
      }),
    );
    return found.includes(true);
  }

  return {
    async decideNativeGroups() {
      // Where tabs cannot also be hidden, native groups are the only kind, and not a choice
      if (!capabilities.hasTabGroups || !capabilities.hasTabHide) {
        return;
      }
      if (await options.isSet('useNativeGroups')) {
        return;
      }

      const keep = await hasSomethingToKeep();
      await options.save({ useNativeGroups: !keep });
      logger.debug(
        keep
          ? '[FirstRun] Tabs or groups are in place: native tab groups stay off until the user turns them on'
          : '[FirstRun] Nothing to move: native tab groups are on',
      );
    },
  };
}
