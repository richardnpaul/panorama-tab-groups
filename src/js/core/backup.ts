import type { Rect } from '../ports/group-state.js';
import { isNumber, isRecord, isString } from '../share/guards.js';

export interface BackupGroup {
  id: number;
  name: string;
  rect: Rect;
}

export interface BackupTab {
  url: string;
  title: string | undefined;
  // The group the tab was in; none for a tab that had not been put in one
  groupId: number | undefined;
  index: number | undefined;
  lastAccessed: number | undefined;
  pinned: boolean;
}

/** Where a window was on the screen */
export interface BackupPosition {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

export interface BackupWindow {
  groups: BackupGroup[];
  tabs: BackupTab[];
  activeGroup: number | undefined;
  groupIndex: number | undefined;
  position: BackupPosition | undefined;
}

export interface Backup {
  file: { type: 'tgvView'; version: 1 };
  windows: BackupWindow[];
}

const isInteger = (value: unknown): value is number =>
  isNumber(value) && Number.isInteger(value);

const optionalNumber = (value: unknown): number | undefined =>
  isNumber(value) ? value : undefined;

function parseRect(value: unknown): Rect | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { x, y, w, h } = value;
  return isNumber(x) && isNumber(y) && isNumber(w) && isNumber(h)
    ? { x, y, w, h }
    : undefined;
}

function parseGroup(value: unknown): BackupGroup | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const rect = parseRect(value.rect);
  return isInteger(value.id) && isString(value.name) && rect !== undefined
    ? { id: value.id, name: value.name, rect }
    : undefined;
}

function parseTab(value: unknown): BackupTab | undefined {
  if (!isRecord(value) || !isString(value.url)) {
    return undefined;
  }
  return {
    url: value.url,
    title: isString(value.title) ? value.title : undefined,
    groupId: isInteger(value.groupId) ? value.groupId : undefined,
    index: optionalNumber(value.index),
    lastAccessed: optionalNumber(value.lastAccessed),
    pinned: value.pinned === true,
  };
}

function parsePosition(value: unknown): BackupPosition | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { left, top, width, height } = value;
  return {
    ...(isNumber(left) ? { left } : {}),
    ...(isNumber(top) ? { top } : {}),
    ...(isNumber(width) ? { width } : {}),
    ...(isNumber(height) ? { height } : {}),
  };
}

// Each item that is not what it should be is left out
const parseAll = <T>(
  value: unknown,
  parse: (item: unknown) => T | undefined,
): T[] | undefined =>
  Array.isArray(value)
    ? value.flatMap((item: unknown) => parse(item) ?? [])
    : undefined;

function parseWindow(value: unknown): BackupWindow | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const groups = parseAll(value.groups, parseGroup);
  const tabs = parseAll(value.tabs, parseTab);
  return groups === undefined || tabs === undefined
    ? undefined
    : {
        groups,
        tabs,
        activeGroup: optionalNumber(value.activeGroup),
        groupIndex: optionalNumber(value.groupIndex),
        position: parsePosition(value.position),
      };
}

function parseViewerBackup(data: Record<string, unknown>): Backup | undefined {
  const windows = parseAll(data.windows, parseWindow);
  return windows === undefined
    ? undefined
    : { file: { type: 'tgvView', version: 1 }, windows };
}

// What JSON text says, or nothing if it is not JSON
function jsonOf(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// Tab Groups keeps what it knows about a window or tab as JSON text
const parseExtData = (extData: unknown, key: string): unknown =>
  isRecord(extData) && isString(extData[key])
    ? jsonOf(extData[key])
    : undefined;

/** The groups of an old Tab Groups window, laid out side by side, a little lower each */
function convertGroups(oldGroups: unknown[]): BackupGroup[] {
  const deltaX = 1 / (oldGroups.length < 4 ? 4 : oldGroups.length + 1);
  const deltaY = 1 / 32;

  return oldGroups.flatMap((oldGroup, index) =>
    isRecord(oldGroup) && isInteger(oldGroup.id) && isString(oldGroup.title)
      ? [
          {
            id: oldGroup.id,
            name: oldGroup.title,
            rect: { x: index * deltaX, y: index * deltaY, w: 0.25, h: 0.5 },
          },
        ]
      : [],
  );
}

const groupIdOf = (tabData: unknown): unknown =>
  isRecord(tabData) ? tabData.groupID : undefined;

function convertTab(oldTab: unknown, index: number): BackupTab | undefined {
  if (!isRecord(oldTab)) {
    return undefined;
  }
  const { entries } = oldTab;
  const entry: unknown = Array.isArray(entries) ? entries[0] : undefined;
  if (!isRecord(entry) || !isString(entry.url)) {
    return undefined;
  }

  const pinned = oldTab.pinned === true;
  // Pinned tabs have no group in Tab Groups
  const tabData = parseExtData(oldTab.extData, 'tabview-tab');
  const groupId = pinned ? 0 : groupIdOf(tabData);
  return isInteger(groupId)
    ? {
        url: entry.url,
        title: isString(entry.title) ? entry.title : undefined,
        groupId,
        index,
        lastAccessed: optionalNumber(oldTab.lastAccessed),
        pinned,
      }
    : undefined;
}

function convertWindow(oldWindow: unknown): BackupWindow | undefined {
  if (!isRecord(oldWindow) || !Array.isArray(oldWindow.tabs)) {
    return undefined;
  }
  const oldGroups = parseExtData(oldWindow.extData, 'tabview-group');
  const settings = parseExtData(oldWindow.extData, 'tabview-groups');
  if (!isRecord(oldGroups) || !isRecord(settings)) {
    return undefined;
  }

  return {
    groups: convertGroups(
      Array.isArray(oldGroups) ? oldGroups : Object.values(oldGroups),
    ),
    tabs: oldWindow.tabs.flatMap(
      (oldTab: unknown, index) => convertTab(oldTab, index) ?? [],
    ),
    activeGroup: optionalNumber(settings.activeGroupId),
    groupIndex: optionalNumber(settings.nextID),
    position: parsePosition({
      left: oldWindow.screenX,
      top: oldWindow.screenY,
      width: oldWindow.width,
      height: oldWindow.height,
    }),
  };
}

function convertTabGroupsBackup(
  data: Record<string, unknown>,
): Backup | undefined {
  const windows = parseAll(data.windows, convertWindow);
  return windows === undefined
    ? undefined
    : { file: { type: 'tgvView', version: 1 }, windows };
}

const isVersion = (version: unknown, ...names: string[]): boolean =>
  Array.isArray(version) &&
  isString(version[0]) &&
  names.includes(version[0]) &&
  version[1] === 1;

// The names a backup can give itself: the second is what backups made before the
// add-on was renamed say, still read and no longer written
const READABLE_FILE_TYPES = ['tgvView', 'panoramaView'];

/**
 * The backup in what was read from a file: one this extension saved (under its
 * name now or before it was renamed), or one from the Tab Groups add-on that it
 * replaces. Nothing if it is none of these.
 */
export function parseBackup(text: string): Backup | undefined {
  const data = jsonOf(text);
  if (!isRecord(data)) {
    return undefined;
  }

  if (
    isRecord(data.file) &&
    isString(data.file.type) &&
    READABLE_FILE_TYPES.includes(data.file.type) &&
    data.file.version === 1
  ) {
    return parseViewerBackup(data);
  }
  return isVersion(data.version, 'tabGroups', 'sessionrestore')
    ? convertTabGroupsBackup(data)
    : undefined;
}

/**
 * The groups of a window to open: its own, or one for each group its tabs were in,
 * named as a new group is
 */
export function groupsToOpen(
  window: BackupWindow,
  defaultName: (id: number) => string,
): BackupGroup[] {
  if (window.groups.length > 0) {
    return window.groups;
  }

  const ids = [...new Set(window.tabs.flatMap(({ groupId }) => groupId ?? []))];
  return ids.map((id, index) => ({
    id,
    name: defaultName(id),
    rect: { x: index / ids.length, y: 0, w: 1 / ids.length, h: 0.5 },
  }));
}

// Two digits, so the year is the last two of it
const pad = (value: number): string => String(value).padStart(2, '0').slice(-2);

/** The name of the file a backup made at this time is saved as, in local time */
export function backupFileName(date: Date): string {
  const day = `${pad(date.getFullYear())}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `tgvView-backup-${day}-${time}.json`;
}
