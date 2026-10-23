import { describe, expect, it } from 'vitest';
import type { Rect } from '../../../src/js/ports/group-state.js';
import {
  boxOf,
  dropMarkFor,
  moveTargetIndex,
  newGroupRect,
  planTiles,
  snapValue,
  stackingOf,
  tilePosition,
  tilingRects,
  transformRect,
  type Edges,
} from '../../../src/js/core/layout.js';

const edges = (...names: (keyof Edges)[]): Edges => ({
  top: names.includes('top'),
  right: names.includes('right'),
  bottom: names.includes('bottom'),
  left: names.includes('left'),
});

const SPACE = { width: 1000, height: 500 };
const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

describe('core/layout.ts', () => {
  describe('tilingRects', () => {
    it('is nothing for no groups', () => {
      expect(tilingRects(0)).toEqual([]);
    });

    it('gives one group the whole space', () => {
      expect(tilingRects(1)).toEqual([rect(0, 0, 1, 1)]);
    });

    it('puts two groups side by side', () => {
      expect(tilingRects(2)).toEqual([
        rect(0, 0, 0.5, 1),
        rect(0.5, 0, 0.5, 1),
      ]);
    });

    it('puts three groups in two rows, the last row of one', () => {
      expect(tilingRects(3)).toEqual([
        rect(0, 0, 0.5, 0.5),
        rect(0.5, 0, 0.5, 0.5),
        rect(0, 0.5, 1, 0.5),
      ]);
    });

    it('fills a square number of groups in a grid', () => {
      const rects = tilingRects(4);

      expect(rects).toEqual([
        rect(0, 0, 0.5, 0.5),
        rect(0.5, 0, 0.5, 0.5),
        rect(0, 0.5, 0.5, 0.5),
        rect(0.5, 0.5, 0.5, 0.5),
      ]);
    });

    it('puts five groups in rows of three and two', () => {
      expect(tilingRects(5)).toEqual([
        rect(0, 0, 1 / 3, 0.5),
        rect(1 / 3, 0, 1 / 3, 0.5),
        rect(2 / 3, 0, 1 / 3, 0.5),
        rect(0, 0.5, 0.5, 0.5),
        rect(0.5, 0.5, 0.5, 0.5),
      ]);
    });

    it('puts seven groups in rows of three, three and one', () => {
      const rects = tilingRects(7);

      expect(rects).toHaveLength(7);
      expect(rects.filter((each) => each.y === 0)).toHaveLength(3);
      expect(rects.filter((each) => each.y === 2 / 3)).toHaveLength(1);
      expect(rects[6]).toEqual(rect(0, 2 / 3, 1, 1 / 3));
    });

    it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13])(
      'covers the space exactly with %i groups',
      (count) => {
        const area = tilingRects(count).reduce(
          (sum, each) => sum + each.w * each.h,
          0,
        );

        expect(area).toBeCloseTo(1, 10);
      },
    );
  });

  describe('snapValue', () => {
    it.each([
      [10, 12, 5, 12],
      [10, 15, 5, 15],
      [10, 5, 5, 5],
      [10, 16, 5, 10],
      [10, 4, 5, 10],
      [10, 10, 0, 10],
      [10, 10.1, 0, 10],
    ])('snaps %f to %f within %f: %f', (value, target, distance, expected) => {
      expect(snapValue(value, target, distance)).toBe(expected);
    });
  });

  describe('newGroupRect', () => {
    it('is 150 pixels square with its middle where asked, as fractions of the space', () => {
      expect(newGroupRect({ x: 275, y: 175 }, SPACE)).toEqual({
        x: 0.2,
        y: 0.2,
        w: 0.15,
        h: 0.3,
      });
    });
  });

  describe('boxOf', () => {
    it('is the distances of the edges of the group from those of the space', () => {
      const box = boxOf(rect(0.1, 0.2, 0.5, 0.4), SPACE);

      expect(box.top).toBeCloseTo(100, 10);
      expect(box.right).toBeCloseTo(400, 10);
      expect(box.bottom).toBeCloseTo(200, 10);
      expect(box.left).toBeCloseTo(100, 10);
    });

    it('is no smaller than 150 pixels each way', () => {
      expect(boxOf(rect(0.1, 0.2, 0.01, 0.01), SPACE)).toEqual({
        top: 100,
        right: 750,
        bottom: 500 - 100 - 150,
        left: 100,
      });
    });

    it('keeps a group that is larger than that', () => {
      expect(boxOf(rect(0, 0, 0.3, 0.9), SPACE)).toEqual({
        top: 0,
        right: 700,
        bottom: 50,
        left: 0,
      });
    });
  });

  describe('stackingOf', () => {
    it('is the last nine digits of when it was moved', () => {
      expect(stackingOf({ id: 3, lastMoved: 1_700_000_123_456 })).toBe(
        '000123456',
      );
    });

    it('is the whole time when it has fewer digits', () => {
      expect(stackingOf({ id: 3, lastMoved: 12345 })).toBe('12345');
    });

    it.each([[undefined], [0]])(
      'is the number of the group when it was moved at %s',
      (lastMoved) => {
        expect(stackingOf({ id: 4, lastMoved })).toBe('4');
      },
    );

    it('is the number of a group that has no time', () => {
      expect(stackingOf({ id: 4 })).toBe('4');
    });
  });

  describe('planTiles', () => {
    it.each([
      [800, 600, 1, 250, 3, false, false],
      [800, 600, 5, 250, 3, false, false],
      [800, 600, 12, 200, 4, false, false],
      [300, 200, 6, 100, 3, false, false],
      // Too many for large tiles: small square ones
      [300, 200, 20, 50, 6, true, false],
      [150, 150, 10, 37.5, 4, true, false],
      [100, 100, 3, 50, 2, true, false],
      [500, 400, 30, 500 / 7, 7, false, false],
      [2000, 1500, 60, 250, 8, false, false],
      // Too many for any: a deck
      [150, 150, 200, 150, 1, false, true],
      [40, 40, 2, 0, 0, true, true],
      [0, 0, 1, 0, 0, true, true],
    ])(
      'in %i by %i for %i tiles has them %f wide, %i to a row (small: %s, deck: %s)',
      (width, height, count, tileWidth, pitch, small, deck) => {
        const plan = planTiles({ width, height }, count);

        expect(plan.width).toBeCloseTo(tileWidth, 10);
        expect(plan.pitch).toBe(pitch);
        expect(plan.small).toBe(small);
        expect(plan.deck).toBe(deck);
      },
    );

    it('makes large tiles 0.68 as high as wide, and square ones as high as wide', () => {
      expect(planTiles({ width: 800, height: 600 }, 1).height).toBeCloseTo(
        170,
        10,
      );
      expect(planTiles({ width: 300, height: 200 }, 20).height).toBeCloseTo(
        50,
        10,
      );
    });

    it('takes the one big row for exactly as many tiles as it holds', () => {
      const plan = planTiles({ width: 1000, height: 100 }, 6);

      expect(plan.pitch).toBe(6);
      expect(plan.width).toBeCloseTo(147.0588, 3);
    });

    it('has no tiles of a space that has no height', () => {
      const plan = planTiles({ width: 100, height: 0 }, 1);

      expect(plan.width).toBe(0);
      expect(plan.pitch).toBe(0);
      expect(plan.deck).toBe(true);
    });

    it('counts a column more where the tile fits with a pixel to spare', () => {
      // 250 wide tiles in 499 pixels: two, by the pixel of slack allowed
      expect(planTiles({ width: 499, height: 600 }, 1).pitch).toBe(2);
    });

    it('makes the tiles of a deck 0.68 as high as wide', () => {
      expect(planTiles({ width: 150, height: 150 }, 200).height).toBeCloseTo(
        102,
        10,
      );
    });

    it('widens a few tiles to fill a wide space', () => {
      const plan = planTiles({ width: 1000, height: 100 }, 4);

      expect(plan.width).toBeCloseTo(147.0588, 3);
      expect(plan.pitch).toBe(6);
    });

    it('gives a tile that is 55 wide as not small, and one a little narrower as small', () => {
      expect(planTiles({ width: 110, height: 110 }, 4).small).toBe(false);
      expect(planTiles({ width: 108, height: 108 }, 4).small).toBe(true);
    });

    it('tries as many as forty tiles to a row', () => {
      const plan = planTiles({ width: 3600, height: 70 }, 40);

      expect(plan.width).toBe(90);
      expect(plan.pitch).toBe(40);
      expect(plan.deck).toBe(false);
    });
  });

  describe('tilePosition', () => {
    const plan = {
      width: 100,
      height: 68,
      pitch: 3,
      small: false,
      deck: false,
    };

    it.each([
      [0, 0, 0],
      [1, 100, 0],
      [2, 200, 0],
      [3, 0, 68],
      [4, 100, 68],
      [7, 100, 136],
    ])('puts tile %i at %i, %i', (index, left, top) => {
      expect(tilePosition(plan, index)).toEqual({ left, top });
    });

    it('puts every tile of a deck at the corner', () => {
      expect(tilePosition({ ...plan, pitch: 0, deck: true }, 5)).toEqual({
        left: 0,
        top: 0,
      });
    });
  });

  describe('transformRect', () => {
    const base = (overrides: Partial<Parameters<typeof transformRect>[0]>) =>
      transformRect({
        start: rect(0.2, 0.2, 0.4, 0.4),
        edges: edges('top', 'right', 'bottom', 'left'),
        from: { x: 0.5, y: 0.5 },
        to: { x: 0.5, y: 0.5 },
        others: [],
        space: SPACE,
        ...overrides,
      });

    it('stays where it is when the pointer has not moved', () => {
      expect(base({})).toEqual(rect(0.2, 0.2, 0.4, 0.4));
    });

    describe('moving the whole group', () => {
      it('follows the pointer', () => {
        const moved = base({ to: { x: 0.6, y: 0.45 } });

        expect(moved.x).toBeCloseTo(0.3, 10);
        expect(moved.y).toBeCloseTo(0.15, 10);
        expect(moved.w).toBe(0.4);
        expect(moved.h).toBe(0.4);
      });

      it('does not go past the left or top of the space', () => {
        expect(base({ to: { x: 0.1, y: 0.1 } })).toEqual(rect(0, 0, 0.4, 0.4));
      });

      it('may go past the right and bottom of the space, which scrolls', () => {
        const moved = base({ to: { x: 1.4, y: 1.4 } });

        expect(moved.x).toBeCloseTo(1.1, 10);
        expect(moved.y).toBeCloseTo(1.1, 10);
      });

      it('is no smaller than 150 pixels', () => {
        expect(base({ start: rect(0.2, 0.2, 0.01, 0.01) })).toEqual(
          rect(0.2, 0.2, 0.15, 0.3),
        );
      });

      it('sticks by its left edge to the left edge of another group', () => {
        const moved = base({
          to: { x: 0.5 + 0.1 + 0.002, y: 0.5 },
          others: [rect(0.3, 0.7, 0.1, 0.1)],
        });

        expect(moved.x).toBeCloseTo(0.3, 10);
      });

      it('sticks by its left edge to the right edge of another group', () => {
        const moved = base({
          to: { x: 0.5 - 0.1 + 0.003, y: 0.5 },
          others: [rect(0.05, 0.7, 0.05, 0.1)],
        });

        expect(moved.x).toBeCloseTo(0.1, 10);
      });

      it('sticks by its right edge to the left edge of another group', () => {
        const moved = base({
          to: { x: 0.5 + 0.2 - 0.003, y: 0.5 },
          others: [rect(0.8, 0.7, 0.1, 0.1)],
        });

        expect(moved.x).toBeCloseTo(0.4, 10);
      });

      it('sticks by its right edge to the right edge of another group', () => {
        const moved = base({
          to: { x: 0.5 + 0.3 + 0.003, y: 0.5 },
          others: [rect(0.8, 0.7, 0.1, 0.1)],
        });

        expect(moved.x).toBeCloseTo(0.5, 10);
      });

      it('sticks by its top edge to the top edge of another group', () => {
        const moved = base({
          to: { x: 0.5, y: 0.5 + 0.1 + 0.004 },
          others: [rect(0.8, 0.3, 0.1, 0.1)],
        });

        expect(moved.y).toBeCloseTo(0.3, 10);
      });

      it('sticks by its top edge to the bottom edge of another group', () => {
        const moved = base({
          to: { x: 0.5, y: 0.5 - 0.1 + 0.004 },
          others: [rect(0.8, 0.05, 0.1, 0.05)],
        });

        expect(moved.y).toBeCloseTo(0.1, 10);
      });

      it('sticks by its bottom edge to the top edge of another group', () => {
        const moved = base({
          to: { x: 0.5, y: 0.5 + 0.2 - 0.004 },
          others: [rect(0.8, 0.8, 0.1, 0.1)],
        });

        expect(moved.y).toBeCloseTo(0.4, 10);
      });

      it('sticks by its bottom edge to the bottom edge of another group', () => {
        const moved = base({
          to: { x: 0.5, y: 0.5 + 0.304 },
          others: [rect(0.8, 0.6, 0.1, 0.3)],
        });

        expect(moved.y).toBeCloseTo(0.5, 10);
      });

      it('does not stick to a group that is too far', () => {
        const moved = base({
          to: { x: 0.5 + 0.1 + 0.02, y: 0.5 },
          others: [rect(0.3, 0.7, 0.1, 0.1)],
        });

        expect(moved.x).toBeCloseTo(0.32, 10);
      });

      it('sticks to the nearest of several groups in turn', () => {
        const moved = base({
          to: { x: 0.5 + 0.1 + 0.002, y: 0.5 },
          others: [rect(0.9, 0.9, 0.05, 0.05), rect(0.3, 0.7, 0.1, 0.1)],
        });

        expect(moved.x).toBeCloseTo(0.3, 10);
      });
    });

    describe('resizing', () => {
      it('moves the right edge only', () => {
        const resized = base({
          edges: edges('right'),
          to: { x: 0.6, y: 0.9 },
        });

        expect(resized.x).toBe(0.2);
        expect(resized.y).toBe(0.2);
        expect(resized.w).toBeCloseTo(0.5, 10);
        expect(resized.h).toBeCloseTo(0.4, 10);
      });

      it('moves the left edge only', () => {
        const resized = base({
          edges: edges('left'),
          to: { x: 0.4, y: 0.9 },
        });

        expect(resized.x).toBeCloseTo(0.1, 10);
        expect(resized.w).toBeCloseTo(0.5, 10);
        expect(resized.y).toBe(0.2);
        expect(resized.h).toBeCloseTo(0.4, 10);
      });

      it('moves the top edge only', () => {
        const resized = base({
          edges: edges('top'),
          to: { x: 0.9, y: 0.4 },
        });

        expect(resized.y).toBeCloseTo(0.1, 10);
        expect(resized.h).toBeCloseTo(0.5, 10);
        expect(resized.x).toBe(0.2);
        expect(resized.w).toBeCloseTo(0.4, 10);
      });

      it('moves the bottom edge only', () => {
        const resized = base({
          edges: edges('bottom'),
          to: { x: 0.9, y: 0.6 },
        });

        expect(resized.y).toBe(0.2);
        expect(resized.h).toBeCloseTo(0.5, 10);
      });

      it('moves two edges for a corner', () => {
        const resized = base({
          edges: edges('bottom', 'right'),
          to: { x: 0.6, y: 0.6 },
        });

        expect(resized.w).toBeCloseTo(0.5, 10);
        expect(resized.h).toBeCloseTo(0.5, 10);
      });

      it('cannot shrink below 150 pixels, keeping the opposite edge', () => {
        const resized = base({
          edges: edges('right'),
          to: { x: -5, y: 0.5 },
        });

        expect(resized.x).toBe(0.2);
        expect(resized.w).toBe(0.15);
      });

      it('cannot shrink the left edge past the right one', () => {
        const resized = base({
          edges: edges('left'),
          to: { x: 5, y: 0.5 },
        });

        expect(resized.x).toBeCloseTo(0.6 - 0.15, 10);
        expect(resized.w).toBeCloseTo(0.15, 10);
      });

      it('cannot shrink the bottom edge past the top one', () => {
        const resized = base({
          edges: edges('bottom'),
          to: { x: 0.5, y: -5 },
        });

        expect(resized.y).toBe(0.2);
        expect(resized.h).toBe(0.3);
      });

      it('cannot shrink the top edge past the bottom one', () => {
        const resized = base({
          edges: edges('top'),
          to: { x: 0.5, y: 5 },
        });

        expect(resized.y).toBeCloseTo(0.6 - 0.3, 10);
        expect(resized.h).toBeCloseTo(0.3, 10);
      });

      it('cannot go past the left or top of the space', () => {
        const resized = base({
          edges: edges('left', 'top'),
          to: { x: -5, y: -5 },
        });

        expect(resized.x).toBe(0);
        expect(resized.y).toBe(0);
        expect(resized.w).toBeCloseTo(0.6, 10);
        expect(resized.h).toBeCloseTo(0.6, 10);
      });

      it('cannot go past the right or bottom of the space', () => {
        const resized = base({
          edges: edges('right', 'bottom'),
          to: { x: 5, y: 5 },
        });

        expect(resized.w).toBeCloseTo(0.8, 10);
        expect(resized.h).toBeCloseTo(0.8, 10);
      });

      it('makes a group that starts past the right edge no narrower than 150 pixels', () => {
        const resized = base({
          start: rect(0.95, 0.2, 0.3, 0.4),
          edges: edges('right'),
          to: { x: 0.5, y: 0.5 },
        });

        expect(resized.x).toBe(0.95);
        expect(resized.w).toBeCloseTo(0.15, 10);
      });

      const corners: [string, (keyof Edges)[], Rect][] = [
        ['top right', ['top', 'right'], rect(0.2, 0.3, 0.5, 0.3)],
        ['bottom right', ['bottom', 'right'], rect(0.2, 0.2, 0.5, 0.5)],
        ['bottom left', ['bottom', 'left'], rect(0.3, 0.2, 0.3, 0.5)],
        ['top left', ['top', 'left'], rect(0.3, 0.3, 0.3, 0.3)],
        // Not moving the whole group, though three edges follow the pointer
        [
          'top, bottom and left',
          ['top', 'bottom', 'left'],
          rect(0.3, 0.3, 0.3, 0.4),
        ],
        [
          'right, bottom and left',
          ['right', 'bottom', 'left'],
          rect(0.3, 0.2, 0.4, 0.5),
        ],
      ];

      it.each(corners)('resizes by the %s corner', (_name, names, expected) => {
        // The pointer moves a tenth of the space right and down
        const resized = base({
          edges: edges(...names),
          to: { x: 0.6, y: 0.6 },
        });

        expect(resized.x).toBeCloseTo(expected.x, 10);
        expect(resized.y).toBeCloseTo(expected.y, 10);
        expect(resized.w).toBeCloseTo(expected.w, 10);
        expect(resized.h).toBeCloseTo(expected.h, 10);
      });

      it('does not stick the edges that do not move to the groups beside them', () => {
        const resized = base({
          edges: edges('left'),
          to: { x: 0.5, y: 0.5 },
          others: [rect(0.8, 0.605, 0.1, 0.1)],
        });

        expect(resized.h).toBeCloseTo(0.4, 10);
        expect(resized.w).toBeCloseTo(0.4, 10);
      });

      it('sticks the moving left edge to an edge of another group', () => {
        const resized = base({
          edges: edges('left'),
          to: { x: 0.5 + 0.1 + 0.002, y: 0.5 },
          others: [rect(0.3, 0.7, 0.1, 0.1)],
        });

        expect(resized.x).toBe(0.3);
      });

      it('sticks the moving right edge to an edge of another group', () => {
        const resized = base({
          edges: edges('right'),
          to: { x: 0.5 + 0.2 - 0.003, y: 0.5 },
          others: [rect(0.8, 0.7, 0.1, 0.1)],
        });

        expect(resized.w).toBeCloseTo(0.6, 10);
      });

      it('sticks the moving top edge to an edge of another group', () => {
        const resized = base({
          edges: edges('top'),
          to: { x: 0.5, y: 0.5 + 0.1 + 0.004 },
          others: [rect(0.8, 0.3, 0.1, 0.1)],
        });

        expect(resized.y).toBe(0.3);
      });

      it('sticks the moving bottom edge to an edge of another group', () => {
        const resized = base({
          edges: edges('bottom'),
          to: { x: 0.5, y: 0.5 + 0.2 - 0.004 },
          others: [rect(0.8, 0.8, 0.1, 0.1)],
        });

        expect(resized.h).toBeCloseTo(0.6, 10);
      });

      it('does not stick the edges that stay', () => {
        const resized = base({
          edges: edges('right'),
          to: { x: 0.5, y: 0.5 },
          others: [rect(0.18, 0.18, 0.1, 0.1)],
        });

        expect(resized.x).toBe(0.2);
        expect(resized.y).toBe(0.2);
      });
    });
  });

  describe('dropMarkFor', () => {
    const over = { left: 100, top: 40, width: 80, height: 60 };

    it('is before a tab when the pointer is in its first half', () => {
      expect(dropMarkFor(over, 139, 0)).toEqual({
        before: true,
        left: 95,
        top: 40,
        height: 52,
      });
    });

    it('is after a tab when the pointer is in its second half', () => {
      expect(dropMarkFor(over, 140, 0)).toEqual({
        before: false,
        left: 175,
        top: 40,
        height: 52,
      });
    });

    it('is as far down as the page is scrolled', () => {
      expect(dropMarkFor(over, 100, 300).top).toBe(340);
    });
  });

  describe('moveTargetIndex', () => {
    it('has a tab dropped on itself land where it was, or just before, as the callers never do it', () => {
      expect(moveTargetIndex(3, 3, true)).toBe(3);
      expect(moveTargetIndex(3, 3, false)).toBe(2);
    });

    it.each([
      // Moving a tab forward, before another: it lands just before it
      [2, 5, true, 4],
      [2, 5, false, 5],
      // Moving a tab back, after another: it lands just after it
      [5, 2, true, 2],
      [5, 2, false, 1],
    ])(
      'moves the tab at %i %s the tab at %i: to %i',
      (from, over, before, to) => {
        expect(moveTargetIndex(from, over, before)).toBe(to);
      },
    );
  });
});
