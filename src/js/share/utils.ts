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

// Counts that take the "2-4" plural form: ends in 2, 3 or 4, but not 12, 13 or 14
function isFewCount(count: number): boolean {
  return [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100);
}

/**
 * Extract correct plural form for a translated string, by the plural rule of
 * the language the translations are in.
 * For insight for the plural rules see:
 * https://developer.mozilla.org/en-US/docs/Mozilla/Localization/Localization_and_Plurals#List_of_Plural_Rules
 */
export function getPluralForm(
  i18n: I18n,
  pluralCount: number | string = 1,
  translatedString = '',
): string | undefined {
  const count = parseInt(String(pluralCount), 10);
  const pluralRule = parseInt(i18n.getMessage('pluralRule'), 10);
  const pluralForms = translatedString.split('|');

  if (pluralForms.length === 1) {
    return translatedString;
  }

  switch (pluralRule) {
    /*
     * Rule #0 [everything]
     */
    case 0:
      return pluralForms[0];
    /*
     * Rule #1 [is 1]|[everything else]
     */
    case 1:
      return count === 1 ? pluralForms[0] : pluralForms[1];
    /*
     * Rule #2 [0 or 1]|[everything else]
     */
    case 2:
      return count < 2 ? pluralForms[0] : pluralForms[1];
    /*
     * Rule #7 [is 1, excluding 11]|[2-4, excluding 12-14]|[everything else]
     */
    case 7:
      if (count % 10 === 1 && count % 100 !== 11) {
        return pluralForms[0];
      }
      return isFewCount(count) ? pluralForms[1] : pluralForms[2];
    /*
     * Rule #9 [is 1]|[2-4, excluding 12-14]|[everything else]
     */
    case 9:
      if (count === 1) {
        return pluralForms[0];
      }
      return isFewCount(count) ? pluralForms[1] : pluralForms[2];
    default:
      return translatedString;
  }
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(3)} KiB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(3)} MiB`;
  return `${(bytes / 1073741824).toFixed(3)} GiB`;
}
