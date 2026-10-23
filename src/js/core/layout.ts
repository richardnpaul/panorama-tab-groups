import type { Rect } from '../ports/group-state.js';

/** The smallest a group may be drawn, in pixels */
export const MIN_GROUP_SIZE = 150;

/** How close, in pixels, a group's edge has to be to another's to stick to it */
export const SNAP_DISTANCE = 5;

/** Which edges of a group move: all four is moving the whole group */
export interface Edges {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

// Rects are fractions of the space the groups are in, so they survive a resize
const fractionOf = (pixels: number, whole: number): number => pixels / whole;

/**
 * The rects that tile the space with `count` groups: rows as even as can be,
 * as many to a row as the square root, and the last row the remainder.
 */
export function tilingRects(count: number): Rect[] {
  if (count <= 0) {
    return [];
  }
  const perRow = Math.ceil(Math.sqrt(count));
  const fullRows = Math.floor(count / perRow);
  const remainder = count % perRow;
  const rows = [
    ...Array<number>(fullRows).fill(perRow),
    ...(remainder === 0 ? [] : [remainder]),
  ];

  return rows.flatMap((cells, row) =>
    Array.from({ length: cells }, (_, cell) => ({
      x: cell / cells,
      y: row / rows.length,
      w: 1 / cells,
      h: 1 / rows.length,
    })),
  );
}

/** `value`, or `target` if it is within `distance` of it */
export function snapValue(
  value: number,
  target: number,
  distance: number,
): number {
  return value >= target - distance && value <= target + distance
    ? target
    : value;
}

/** The rect of a new group, 150 pixels square with its middle where it was asked for */
export function newGroupRect(point: Point, space: Size): Rect {
  return {
    x: fractionOf(point.x - MIN_GROUP_SIZE / 2, space.width),
    y: fractionOf(point.y - MIN_GROUP_SIZE / 2, space.height),
    w: fractionOf(MIN_GROUP_SIZE, space.width),
    h: fractionOf(MIN_GROUP_SIZE, space.height),
  };
}

/** Where a group goes in its space, as the distances of its edges from the edges of the space */
export interface Box {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** The box of a group, in pixels, never smaller than the least a group may be */
export function boxOf(rect: Rect, space: Size): Box {
  const w = Math.max(rect.w, fractionOf(MIN_GROUP_SIZE, space.width));
  const h = Math.max(rect.h, fractionOf(MIN_GROUP_SIZE, space.height));

  return {
    top: rect.y * space.height,
    right: space.width - (rect.x + w) * space.width,
    bottom: space.height - (rect.y + h) * space.height,
    left: rect.x * space.width,
  };
}

/** What stacks groups: the groups moved last are in front; those never moved by their number */
export function stackingOf(group: {
  id: number;
  lastMoved?: number | undefined;
}): string {
  return group.lastMoved === undefined || group.lastMoved === 0
    ? String(group.id)
    : String(group.lastMoved).slice(-9);
}

interface FitRequest extends Size {
  minWidth: number;
  maxWidth: number;
  // Height of a tile as a fraction of its width
  ratio: number;
  // How many tiles have to fit
  amount: number;
}

interface Fit {
  // Tiles to a row; 0 if they do not fit
  pitch: number;
  // Width of a tile
  width: number;
  ratio: number;
}

// The most tiles to a row tried
const MOST_PER_ROW = 40;

interface Candidate extends Fit {
  // Of one tile, to tell which candidate is better
  area: number;
}

/**
 * The widest tiles that fill rows, for each number of tiles to a row from one,
 * as long as they are wide enough: those that let `amount` of them fit.
 */
function widestThatFit(request: FitRequest): Candidate | undefined {
  const { width, height, minWidth, maxWidth, ratio, amount } = request;
  const widths = Array.from({ length: MOST_PER_ROW }, (_, index) =>
    Math.min(width / (index + 1), maxWidth),
  );
  const tooNarrow = widths.findIndex((candidate) => candidate < minWidth);
  const wide = tooNarrow === -1 ? widths : widths.slice(0, tooNarrow);

  const tileWidth = wide.find(
    (candidate) =>
      // A pixel of slack is allowed in a row
      Math.floor((width + 1) / candidate) *
        Math.floor(height / (candidate * ratio)) >=
      amount,
  );
  return tileWidth === undefined
    ? undefined
    : {
        pitch: Math.floor((width + 1) / tileWidth),
        width: tileWidth,
        ratio,
        area: tileWidth * (tileWidth * ratio),
      };
}

/**
 * Groups with very few tabs look better with one big row of tiles, as large as
 * the space is high; a taller space only gets that row.
 */
function oneBigRow(request: FitRequest): Candidate | undefined {
  const { width, height, maxWidth, ratio, amount } = request;
  const tileHeight = Math.min(height, maxWidth * ratio);
  const tileWidth = tileHeight / ratio;
  const pitch = Math.floor(width / tileWidth);

  return pitch >= amount && tileHeight > 0
    ? { pitch, width: tileWidth, ratio, area: tileWidth * tileHeight }
    : undefined;
}

/** The tiles, within the limits, that fill the space best: the larger the better */
function fitTiles(request: FitRequest): Fit {
  // Of tiles as large, the first is kept: sorting does not reorder equals
  const [best] = [widestThatFit(request), oneBigRow(request)]
    .flatMap((candidate) => candidate ?? [])
    .sort((first, second) => second.area - first.area);

  return best === undefined
    ? { pitch: 0, width: 0, ratio: request.ratio }
    : { pitch: best.pitch, width: best.width, ratio: best.ratio };
}

/** How the tiles of a group are laid out in its content */
export interface TilePlan {
  // Width and height of a tile
  width: number;
  height: number;
  // Tiles to a row
  pitch: number;
  // Tiles so small that only their picture is shown
  small: boolean;
  // Too many tiles to show: they are stacked, with the one in front shown
  deck: boolean;
}

const TILE_RATIO = 0.68;
const SMALL_TILE_WIDTH = 55;

/**
 * How to lay out `count` tiles in the space: large ones if they fit, else
 * small square ones, else a deck of them.
 */
export function planTiles(space: Size, count: number): TilePlan {
  const fits = (limits: {
    minWidth: number;
    maxWidth: number;
    ratio: number;
    amount: number;
  }): Fit => fitTiles({ ...space, ...limits });

  const large = fits({
    minWidth: 90,
    maxWidth: 250,
    ratio: TILE_RATIO,
    amount: count,
  });
  const square =
    large.pitch === 0
      ? fits({ minWidth: 35, maxWidth: 89, ratio: 1, amount: count })
      : large;
  const deck = square.pitch === 0;
  const fit = deck
    ? fits({ minWidth: 45, maxWidth: 250, ratio: TILE_RATIO, amount: 1 })
    : square;

  return {
    width: fit.width,
    height: fit.width * fit.ratio,
    pitch: fit.pitch,
    small: fit.width < SMALL_TILE_WIDTH,
    deck,
  };
}

/** Where the tile at `index` goes, from the top left of the content */
export function tilePosition(
  plan: TilePlan,
  index: number,
): { left: number; top: number } {
  return plan.deck
    ? { left: 0, top: 0 }
    : {
        left: plan.width * (index % plan.pitch),
        top: plan.height * Math.floor(index / plan.pitch),
      };
}

/** One axis of a group while it is dragged: where it starts, where it ends, how long it is */
interface Span {
  start: number;
  end: number;
}

/** Where a span goes when its edges that move stick to the edges of the other groups */
function snapSpan(
  span: Span,
  length: number,
  moves: { first: boolean; last: boolean },
  others: readonly Span[],
  distance: number,
): Span {
  return others.reduce((current, other) => {
    if (moves.first && moves.last) {
      // Moving the whole span: either of its edges may stick to either edge
      const byStart = snapValue(
        snapValue(current.start, other.start, distance),
        other.end,
        distance,
      );
      const byEnd = snapValue(byStart + length, other.start, distance) - length;
      const stuck = snapValue(byEnd + length, other.end, distance) - length;
      return { start: stuck, end: current.end };
    }
    if (moves.first) {
      return {
        start: snapValue(
          snapValue(current.start, other.start, distance),
          other.end,
          distance,
        ),
        end: current.end,
      };
    }
    if (moves.last) {
      return {
        start: current.start,
        end: snapValue(
          snapValue(current.end, other.start, distance),
          other.end,
          distance,
        ),
      };
    }
    return current;
  }, span);
}

/** What is needed to work out where a group is when it is dragged */
export interface Transform {
  // The group as it was when the drag began, and which of its edges move
  start: Rect;
  edges: Edges;
  // Where the pointer was when the drag began, and is now, as fractions of the space
  from: Point;
  to: Point;
  others: readonly Rect[];
  space: Size;
}

/**
 * The rect of a group that is moved or resized by dragging: its edges that move
 * follow the pointer, stick to the edges of the other groups when close, and
 * stay inside the space and no smaller than the least a group may be. Moving
 * a group (all four edges) may go on past the right and bottom of the space,
 * which then scrolls.
 */
export function transformRect({
  start,
  edges,
  from,
  to,
  others,
  space,
}: Transform): Rect {
  const minW = fractionOf(MIN_GROUP_SIZE, space.width);
  const minH = fractionOf(MIN_GROUP_SIZE, space.height);
  const w = Math.max(start.w, minW);
  const h = Math.max(start.h, minH);
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  const horizontal = snapSpan(
    {
      start: start.x + (edges.left ? dx : 0),
      end: start.x + w + (edges.right ? dx : 0),
    },
    w,
    { first: edges.left, last: edges.right },
    others.map((other) => ({ start: other.x, end: other.x + other.w })),
    fractionOf(SNAP_DISTANCE, space.width),
  );
  const vertical = snapSpan(
    {
      start: start.y + (edges.top ? dy : 0),
      end: start.y + h + (edges.bottom ? dy : 0),
    },
    h,
    { first: edges.top, last: edges.bottom },
    others.map((other) => ({ start: other.y, end: other.y + other.h })),
    fractionOf(SNAP_DISTANCE, space.height),
  );

  if (edges.top && edges.right && edges.bottom && edges.left) {
    return {
      x: Math.max(horizontal.start, 0),
      y: Math.max(vertical.start, 0),
      w,
      h,
    };
  }

  // The edges that move stay inside the space; where that leaves less than the
  // least a group may be, the group is made that large instead
  const x = edges.left
    ? Math.min(Math.max(horizontal.start, 0), horizontal.end - minW)
    : horizontal.start;
  const right = edges.right ? Math.min(horizontal.end, 1) : horizontal.end;
  const y = edges.top
    ? Math.min(Math.max(vertical.start, 0), vertical.end - minH)
    : vertical.start;
  const bottom = edges.bottom ? Math.min(vertical.end, 1) : vertical.end;

  return {
    x,
    y,
    w: Math.max(right - x, minW),
    h: Math.max(bottom - y, minH),
  };
}

/** Where the mark that shows where a dragged tab will drop goes, beside the tab dragged over */
export function dropMarkFor(
  over: { left: number; top: number; width: number; height: number },
  pointerX: number,
  scrollY: number,
): { before: boolean; left: number; top: number; height: number } {
  const before = pointerX < over.left + over.width / 2;
  return {
    before,
    left: before ? over.left - 5 : over.left + over.width - 5,
    top: scrollY + over.top,
    height: over.height - 8,
  };
}

/**
 * The place in the window to move a tab to when it is dropped before or after
 * another: the move takes the tab out first, so places after it count one less.
 */
export function moveTargetIndex(
  tabIndex: number,
  overIndex: number,
  before: boolean,
): number {
  const movesForward = tabIndex < overIndex;
  return movesForward === before ? overIndex - 1 : overIndex;
}
