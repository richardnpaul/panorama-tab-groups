import { isBoolean, isNumber, isRecord } from '../share/guards.js';

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
