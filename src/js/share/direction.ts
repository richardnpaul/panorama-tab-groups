import type { I18n } from '../ports/i18n.js';

/** What a page needs to set on itself to show the language of the browser */
export interface Root {
  dir: string;
  lang: string;
}

/**
 * Tell the page the language and the direction of text it is shown in, so that
 * text runs and the page lays out from the right in the languages that do. The
 * browser knows both for its own language: `@@bidi_dir` is "ltr" or "rtl".
 */
export function applyLanguage(
  i18n: Pick<I18n, 'getMessage'>,
  root: Root,
): void {
  root.dir = i18n.getMessage('@@bidi_dir') === 'rtl' ? 'rtl' : 'ltr';
  // A language tag has a hyphen where the browser's name for the locale has an underscore
  const locale = i18n.getMessage('@@ui_locale').replaceAll('_', '-');
  // Not set where the browser gives none, as a page that has no language is read in the browser's
  if (/^[A-Za-z]{2,3}(-[A-Za-z0-9]+)*$/u.test(locale)) {
    root.lang = locale;
  }
}
