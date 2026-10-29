import type { Rect } from '../ports/group-state.js';

/** A search shorter than this is not searched for: it would match nearly everything */
export const MIN_SEARCH_LENGTH = 2;

/** What the search of the popup is to do about the text in the field */
export type SearchMode = 'results' | 'groups' | 'keep';

/**
 * The text is searched for when it is long enough; the groups are shown again
 * when the field is emptied; in between, what is shown stays.
 */
export function searchMode(query: string): SearchMode {
  if (query.length >= MIN_SEARCH_LENGTH) {
    return 'results';
  }
  return query.length === 0 ? 'groups' : 'keep';
}

export interface Searchable {
  title: string;
  url: string | undefined;
}

/**
 * The tabs that have the text in the title or the address, whatever the case.
 * The text is not a pattern: what the user types is what is looked for.
 */
export function matchingTabs<T extends Searchable>(
  tabs: readonly T[],
  query: string,
): T[] {
  const wanted = query.toLowerCase();
  return tabs.filter(({ title, url }) =>
    [title, url].some((text) => text?.toLowerCase().includes(wanted) === true),
  );
}

/** The groups that have a tab that matches, each with the tabs of it that match */
export function searchGroups<T extends Searchable, G extends { tabs: T[] }>(
  groups: readonly G[],
  query: string,
): { group: G; tabs: T[] }[] {
  return groups
    .map((group) => ({ group, tabs: matchingTabs(group.tabs, query) }))
    .filter(({ tabs }) => tabs.length > 0);
}

/** The name a group is given when the user types `typed`: a blank name keeps the one it has */
export function nextGroupName(current: string, typed: string): string {
  const name = typed.trim();
  return name === '' ? current : name;
}

/** The one used last; of those used at the same time, the first. Nothing for those never used. */
export function mostRecent<T extends { lastAccessed: number }>(
  items: readonly T[],
): T | null {
  return items.reduce<T | null>(
    (best, item) =>
      item.lastAccessed > (best?.lastAccessed ?? 0) ? item : best,
    null,
  );
}

/**
 * The order of the groups after one is dropped at a place in the list, where
 * the place is the gap the group was dropped in (0 is before the first, the
 * length is after the last).
 */
export function moveGroupTo(
  ids: readonly number[],
  id: number,
  gap: number,
): number[] {
  const current = ids.indexOf(id);
  if (current === -1) {
    return [...ids];
  }
  // The gap counts the group itself, which is taken out of the list first
  const place = gap > current ? gap - 1 : gap;
  const others = ids.filter((other) => other !== id);
  return [...others.slice(0, place), id, ...others.slice(place)];
}

// How many groups fit in a row and a column, for the number of groups
function gridFor(count: number): { columns: number; rows: number } {
  if (count <= 8) {
    return { columns: 4, rows: 2 };
  }
  return count <= 18 ? { columns: 6, rows: 3 } : { columns: 8, rows: 4 };
}

/**
 * Where the group at `index` of `count` groups goes in the space of the
 * groups, so that new groups come in a grid rather than on top of each other.
 */
export function gridRect(index: number, count: number): Rect {
  const { columns, rows } = gridFor(count);
  const slot = index % (columns * rows);
  return {
    x: (slot % columns) / columns,
    y: Math.floor(slot / columns) / rows,
    w: 1 / columns,
    h: 1 / rows,
  };
}

export type NavKey = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';

const NAV_KEYS: readonly string[] = [
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
];

export function isNavKey(key: string): key is NavKey {
  return NAV_KEYS.includes(key);
}

export interface NavPosition {
  /** The row, and the place in it, of what has the focus */
  row: number;
  column: number;
  /** The place in a row that moving up and down tries to keep */
  wanted: number;
}

const wrap = (value: number, size: number): number => (value + size) % size;

/**
 * Whether the key points the way reading goes along a row: right where text runs
 * from the left, and left where it runs from the right, since the page is laid
 * out the other way round there and the next thing is at the left.
 */
export const isForwardKey = (key: NavKey, rtl: boolean): boolean =>
  key === (rtl ? 'ArrowLeft' : 'ArrowRight');

/** Whether the key points back along a row, the other way */
export const isBackKey = (key: NavKey, rtl: boolean): boolean =>
  key === (rtl ? 'ArrowRight' : 'ArrowLeft');

const ROW_STEPS: Record<'ArrowUp' | 'ArrowDown', number> = {
  ArrowUp: -1,
  ArrowDown: 1,
};

/**
 * Where the focus goes for an arrow key, in rows of things that can have the
 * focus: up and down go to the row above and below, and round the ends; left
 * and right go along the row, and round its ends (the other way round where
 * text runs from the right, `rtl`). Up and down keep to the
 * place in the row the user was last at, as far as the row they go to reaches.
 * Nothing when the row they go to has nothing to focus.
 */
export function navigate(
  key: NavKey,
  rowSizes: readonly number[],
  at: NavPosition,
  rtl = false,
): NavPosition | null {
  const along = key === 'ArrowLeft' || key === 'ArrowRight';
  const row =
    key === 'ArrowUp' || key === 'ArrowDown'
      ? wrap(at.row + ROW_STEPS[key], rowSizes.length)
      : at.row;
  const size = rowSizes[row] ?? 0;
  if (size === 0) {
    return null;
  }

  const column = along
    ? wrap(at.column + (isForwardKey(key, rtl) ? 1 : -1), size)
    : Math.min(at.wanted, size - 1);
  return { row, column, wanted: along ? column : at.wanted };
}
