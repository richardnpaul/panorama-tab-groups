import { pluralCategory, selectPluralForm } from '../core/plural.js';
import type { I18n } from '../ports/i18n.js';

/**
 * Helper function to create a new element with the given attributes and children
 */
export function newElement(
  name: string,
  attributes: Record<string, string | number>,
  children?: readonly Node[],
): HTMLElement {
  const e = document.createElement(name);
  Object.entries(attributes).forEach(([key, value]) => {
    if (key === 'content') {
      e.appendChild(document.createTextNode(String(value)));
    } else {
      e.setAttribute(key.replace(/_/g, '-'), String(value));
    }
  });
  (children ?? []).forEach((child) => {
    e.appendChild(child);
  });
  return e;
}

/**
 * The form of a translated message that fits the count, in the language of the
 * browser: "one=$1 tab|other=$1 tabs" gives the first for 1 and the second for
 * the rest (see `core/plural.ts` for the format).
 */
export function getPluralForm(
  i18n: Pick<I18n, 'getMessage'>,
  pluralCount: number | string = 1,
  translatedString = '',
): string {
  const count = parseInt(String(pluralCount), 10);
  return selectPluralForm(
    translatedString,
    pluralCategory(i18n.getMessage('@@ui_locale'), count),
  );
}

/** The number as the language of the browser writes it, with this many digits after the point */
function formatNumber(
  i18n: Pick<I18n, 'getMessage'>,
  value: number,
  digits: number,
): string {
  const options = {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  };
  try {
    return new Intl.NumberFormat(
      i18n.getMessage('@@ui_locale').replaceAll('_', '-'),
      options,
    ).format(value);
  } catch {
    // Not a language tag, as a browser that gives no answer shows
    return new Intl.NumberFormat('en', options).format(value);
  }
}

/** A whole number as the language of the browser writes it (its digits and its grouping) */
export const formatCount = (
  i18n: Pick<I18n, 'getMessage'>,
  value: number,
): string => formatNumber(i18n, value, 0);

// The sizes, smallest first: the message that names the unit, and what a byte count is divided by
const SMALLER_SIZES = [
  { below: 1024, name: 'byteSizeBytes', divisor: 1, digits: 0 },
  { below: 1048576, name: 'byteSizeKiB', divisor: 1024, digits: 3 },
  { below: 1073741824, name: 'byteSizeMiB', divisor: 1048576, digits: 3 },
] as const;
const LARGEST_SIZE = {
  name: 'byteSizeGiB',
  divisor: 1073741824,
  digits: 3,
} as const;

/** A size in bytes in the largest unit that keeps it above 1, in the words and numbers of the browser's language */
export function formatByteSize(
  i18n: Pick<I18n, 'getMessage'>,
  bytes: number,
): string {
  const { name, divisor, digits } =
    SMALLER_SIZES.find(({ below }) => bytes < below) ?? LARGEST_SIZE;
  return i18n.getMessage(name, [formatNumber(i18n, bytes / divisor, digits)]);
}
