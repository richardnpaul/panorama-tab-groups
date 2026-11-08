import { isBoolean, isNumber, isRecord, isString } from '../share/guards.js';

/** What the view asks for when the user deletes a group */
export interface GroupDeletionRequest {
  groupId: number;
  windowId: number;
  // The group may never have had a native tab group
  nativeGroupId: number | null | undefined;
  tabIds: number[];
}

const isId = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);

const isIds = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every(isId);

/** The deletion that was asked for, or nothing if the message does not ask for one */
export function parseGroupDeletion(
  message: Record<string, unknown>,
): GroupDeletionRequest | undefined {
  const { groupId, windowId, nativeGroupId, tabIds } = message;
  if (
    !isId(groupId) ||
    !isId(windowId) ||
    !isIds(tabIds) ||
    !(
      nativeGroupId === undefined ||
      nativeGroupId === null ||
      isId(nativeGroupId)
    )
  ) {
    return undefined;
  }
  return { groupId, windowId, nativeGroupId, tabIds };
}

/** Where the view put a tab it dropped: in a group, and next to a tab, if it was dropped by one */
export interface TabPlacement {
  tabId: number;
  groupId: number;
  windowId: number;
  beside: { tabId: number; before: boolean } | undefined;
}

/** The placement that was asked for, or nothing if the message does not ask for one */
export function parseTabPlacement(
  message: Record<string, unknown>,
): TabPlacement | undefined {
  const { tabId, groupId, windowId, beside } = message;
  if (!isId(tabId) || !isId(groupId) || !isId(windowId)) {
    return undefined;
  }
  if (beside === undefined) {
    return { tabId, groupId, windowId, beside };
  }
  return isRecord(beside) && isId(beside.tabId) && isBoolean(beside.before)
    ? {
        tabId,
        groupId,
        windowId,
        beside: { tabId: beside.tabId, before: beside.before },
      }
    : undefined;
}

/**
 * Whether a backup is being opened, as the options page says: the only thing
 * of the background it may change.
 */
export function parseOpeningBackup(
  message: Record<string, unknown>,
): boolean | undefined {
  return message.key === 'openingBackup' && isBoolean(message.value)
    ? message.value
    : undefined;
}

/** Whether the background's answer says it did what it was asked */
export const isSuccess = (answer: unknown): boolean =>
  isRecord(answer) && answer.success === true;

/** A message to the background, which names what it asks for */
export interface Envelope {
  action: string;
  message: Record<string, unknown>;
}

export function openEnvelope(message: unknown): Envelope | undefined {
  return isRecord(message) && typeof message.action === 'string'
    ? { action: message.action, message }
    : undefined;
}

/** What the view asks for when a group's context-menu item changes */
export type MenuChange =
  | {
      action: 'createMenuItem' | 'updateMenuItem';
      windowId: number;
      groupId: number;
      groupName: string;
    }
  | { action: 'removeMenuItem'; windowId: number; groupId: number };

/** The menu change that was asked for, or nothing if the message does not ask for one */
export function parseMenuChange(
  message: Record<string, unknown>,
): MenuChange | undefined {
  const { action, windowId, groupId, groupName } = message;
  if (!isId(windowId) || !isId(groupId)) {
    return undefined;
  }
  if (action === 'removeMenuItem') {
    return { action, windowId, groupId };
  }
  if (
    (action === 'createMenuItem' || action === 'updateMenuItem') &&
    isString(groupName)
  ) {
    return { action, windowId, groupId, groupName };
  }
  return undefined;
}
