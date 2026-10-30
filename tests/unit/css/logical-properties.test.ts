import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The sheets that style what a person reads; the colour sheets only name colours
const SHEETS = [
  'src/css/view.css',
  'src/css/group.css',
  'src/css/tab.css',
  'src/css/dark.css',
  'src/css/options.css',
  'src/popup-view/css/base.css',
  'src/shared/css/theme-components.css',
];

/**
 * The places that are physical on purpose, as the user chose them or as the picture of
 * a window is: the toolbar the user put on the left or the right, and the handles on the
 * edges of a group in the freeform view, which is a canvas that does not turn round.
 */
const PHYSICAL_ON_PURPOSE =
  /toolbar-(left|right)|\.group \.(left|right|topLeft|topRight|bottomLeft|bottomRight)\b/u;

const PHYSICAL_SIDES =
  /(?:^|[;\s])((?:margin|padding|border)-(?:left|right)(?:-[a-z]+)?|text-align:\s*(?:left|right)|float:\s*(?:left|right))/gu;

interface Block {
  selector: string;
  body: string;
}

/** The blocks of a sheet that hold declarations, the innermost of those in a media query too */
function blocksOf(css: string): Block[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map(
    ([, selector = '', body = '']) => ({
      selector: selector.trim().replace(/\s+/gu, ' '),
      body,
    }),
  );
}

/** A side that has an offset without the opposite one is a side, not an extent */
function oneSidedOffsets(body: string): string[] {
  const has = (side: string): boolean =>
    new RegExp(`(?:^|[;\\s])${side}\\s*:`, 'u').test(body);
  return [
    ...(has('left') && !has('right') ? ['left'] : []),
    ...(has('right') && !has('left') ? ['right'] : []),
  ];
}

function physicalIn(sheet: string): string[] {
  return blocksOf(readFileSync(sheet, 'utf8'))
    .filter(({ selector }) => !PHYSICAL_ON_PURPOSE.test(selector))
    .flatMap(({ selector, body }) => [
      ...[...body.matchAll(PHYSICAL_SIDES)].map(
        ([, property]) => `${sheet}: ${selector} { ${property ?? ''} }`,
      ),
      ...oneSidedOffsets(body).map(
        (side) => `${sheet}: ${selector} { ${side}: ... }`,
      ),
    ]);
}

describe('stylesheets and the direction of text', () => {
  it.each(SHEETS)(
    '%s names no physical side where the side depends on how text runs',
    (sheet) => {
      expect(physicalIn(sheet)).toEqual([]);
    },
  );

  describe('the check itself', () => {
    const flaggedIn = (css: string): (string | undefined)[] =>
      blocksOf(css).flatMap(({ body }) => [
        ...[...body.matchAll(PHYSICAL_SIDES)].map(([, property]) => property),
        ...oneSidedOffsets(body),
      ]);

    it.each([
      ['margin-left: 4px', 'margin-left'],
      ['padding-right: 1px', 'padding-right'],
      ['border-left-color: red', 'border-left-color'],
      ['text-align: left', 'text-align: left'],
      ['float:right', 'float:right'],
      ['left: 0', 'left'],
      ['right: 0', 'right'],
    ])('flags %s', (declaration, flagged) => {
      expect(flaggedIn(`a { color: red; ${declaration}; }`)).toEqual([flagged]);
    });

    it.each([
      'margin-inline-start: 4px',
      'padding-inline-end: 1px',
      'border-inline-start: 1px solid',
      'text-align: center',
      'text-align: start',
      'inset-inline-start: 0',
      'left: 4px; right: 4px',
    ])('does not flag %s', (declaration) => {
      expect(flaggedIn(`a { ${declaration}; }`)).toEqual([]);
    });

    it('looks inside a media query, and not at comments', () => {
      expect(
        flaggedIn(
          '@media (x) { a { margin-left: 1px } } /* b { float: left } */',
        ),
      ).toEqual(['margin-left']);
    });
  });
});
