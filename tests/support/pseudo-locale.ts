/**
 * A pseudo-locale, for tests only: English made to look like a language that is
 * wider and written differently, so that a page shows what it would do in one.
 *
 * Every text comes out accented, about 40% longer and in square brackets, so a
 * text that is not from a message shows (it has no brackets), a text that does
 * not fit shows, and with `rtl` the browser is told the language runs from the
 * right.
 *
 * Nothing here may refer to anything outside `pseudoLocalize` and `install`: the
 * two are sent to a page as text, to run before the page's own scripts.
 */

/** The text as the pseudo-locale writes it: parts of a placeholder or a name in braces are left alone */
export function pseudoLocalize(text: string): string {
  const accents: Record<string, string> = {
    a: 'á',
    e: 'é',
    i: 'í',
    o: 'ö',
    u: 'ü',
    c: 'ç',
    n: 'ñ',
    s: 'š',
    y: 'ý',
    A: 'Å',
    E: 'É',
    I: 'Î',
    O: 'Ø',
    U: 'Û',
    C: 'Ç',
    N: 'Ñ',
    S: 'Š',
    Y: 'Ý',
  };
  const accented = text
    .split(/(\{[^}]*\}|\$\d+)/u)
    .map((part, index) =>
      // The odd parts are what the split kept: a name in braces or a placeholder
      index % 2 === 1
        ? part
        : part.replace(/[a-zA-Z]/gu, (letter) => accents[letter] ?? letter),
    )
    .join('');
  const longer = accented.slice(0, Math.ceil(accented.length * 0.4)).trimEnd();
  return `[${accented} ${longer}]`;
}

/** What the page is told: the extension's messages go through the pseudo-locale, in this direction */
export interface PseudoOptions {
  rtl: boolean;
}

declare const pseudoLocalizeInPage: (text: string) => string;
declare const chrome: {
  i18n: { getMessage: (name: string, substitutions?: string[]) => string };
};

/** Run in the page: wrap the browser's own i18n so that messages come out as the pseudo-locale */
export function install(options: PseudoOptions): void {
  const original = chrome.i18n.getMessage.bind(chrome.i18n);
  chrome.i18n.getMessage = (name, substitutions) => {
    if (name === '@@bidi_dir') {
      return options.rtl ? 'rtl' : 'ltr';
    }
    if (name === '@@ui_locale') {
      return options.rtl ? 'ar' : 'en';
    }
    return pseudoLocalizeInPage(original(name, substitutions));
  };
}

/** The script that makes the pseudo-locale in a page, to be added as an initial script of the page */
export const pseudoLocaleScript = (options: PseudoOptions): string =>
  `const pseudoLocalizeInPage = ${pseudoLocalize.toString()};
(${install.toString()})(${JSON.stringify(options)});`;
