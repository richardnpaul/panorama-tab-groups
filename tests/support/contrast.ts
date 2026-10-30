/** An opaque colour as red, green and blue, 0 to 255 */
export type Rgb = readonly [number, number, number];

function toRgb(values: readonly number[]): Rgb {
  const [red, green, blue] = values;
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error('a colour has three channels');
  }
  return [red, green, blue];
}

/** The numbers captured by a match, from the first group on */
const captured = (match: RegExpExecArray): string[] => match.slice(1);

/**
 * Read a colour written as #rrggbb, #rgb or rgb(r, g, b), which is what a
 * stylesheet holds and what a browser reports as a computed colour.
 */
export function parseColor(text: string): Rgb {
  const value = text.trim().toLowerCase();

  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/u.exec(value);
  if (short !== null) {
    return toRgb(captured(short).map((digit) => parseInt(digit.repeat(2), 16)));
  }

  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/u.exec(value);
  if (long !== null) {
    return toRgb(captured(long).map((pair) => parseInt(pair, 16)));
  }

  const functional = /^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/u.exec(value);
  if (functional !== null) {
    return toRgb(captured(functional).map(Number));
  }

  throw new Error(`not an opaque colour: ${text}`);
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const linear = (channel: number): number => {
    const unit = channel / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(red) + 0.7152 * linear(green) + 0.0722 * linear(blue);
}

/** The WCAG 2 contrast ratio of two colours, from 1 (the same) to 21 (black on white) */
export function contrastRatio(first: string, second: string): number {
  const [lighter = 0, darker = 0] = [
    relativeLuminance(parseColor(first)),
    relativeLuminance(parseColor(second)),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.2 AA: text needs 4.5, the edge of a control or a focus ring 3 */
export const TEXT_CONTRAST = 4.5;
export const CONTROL_CONTRAST = 3;
