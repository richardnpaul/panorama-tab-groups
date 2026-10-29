/**
 * A folder of translations as the language of a page, for tests of a language that the browser
 * cannot be set to (Chromium has 55 languages and Firefox another 73, and Chromium is the browser
 * the pages can be shown in): the page's `getMessage` answers with the folder's messages, as the
 * browser does for the language it is set to, English for a message the folder lacks, and the
 * language and the direction the browser would say.
 *
 * Nothing here may refer to anything outside `install`: it is sent to a page as text, to run before
 * the page's own scripts.
 */

export interface FolderLocale {
  folder: string;
  messages: Record<string, string>;
  rtl: boolean;
}

declare const chrome: {
  i18n: {
    getMessage: (name: string, substitutions?: string | string[]) => string;
  };
};

/** Run in the page: wrap the browser's own i18n so that messages come from the folder */
function install(locale: FolderLocale): void {
  const original = chrome.i18n.getMessage.bind(chrome.i18n);
  chrome.i18n.getMessage = (name, substitutions) => {
    if (name === '@@bidi_dir') {
      return locale.rtl ? 'rtl' : 'ltr';
    }
    if (name === '@@ui_locale') {
      return locale.folder;
    }
    const own = locale.messages[name];
    if (own === undefined) {
      return original(name, substitutions);
    }
    const given = substitutions === undefined ? [] : [substitutions].flat();
    return own.replace(
      /\$(\d)/gu,
      (whole, digit: string) => given[Number(digit) - 1] ?? whole,
    );
  };
}

/** The script that makes the folder the language of a page, to be added as an initial script of the page */
export const folderLocaleScript = (locale: FolderLocale): string =>
  `(${install.toString()})(${JSON.stringify(locale)});`;
