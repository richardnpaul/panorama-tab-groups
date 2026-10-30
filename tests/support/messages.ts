import { readLocale } from './locales.js';

/**
 * A stand-in for the browser's messages that shows where each text comes from:
 * the name of the message in ⟦ ⟧, with the substitutions it was given. A page
 * that is shown with these has English in it wherever a text lacks the marks.
 */
const MARK_OPEN = '⟦';
const MARK_CLOSE = '⟧';

export function markedMessage(
  name: string,
  substitutions: readonly string[] = [],
): string {
  const given = substitutions.length === 0 ? '' : `:${substitutions.join(',')}`;
  return `${MARK_OPEN}${name}${given}${MARK_CLOSE}`;
}

/** Attributes whose value a person reads or hears */
const READ_ATTRIBUTES = ['title', 'placeholder', 'alt', 'aria-label'];

// What a person reads is made of letters; a number, a symbol or a path is not a text to translate
const hasWords = (text: string): boolean => /\p{L}{2}/u.test(text);

const isMarked = (text: string): boolean => text.includes(MARK_OPEN);

/** The texts shown on the page that do not come from a message, with where they are */
export function textsOutsideMessages(root: ParentNode): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ALL);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node instanceof Element) {
      READ_ATTRIBUTES.forEach((attribute) => {
        const value = node.getAttribute(attribute) ?? '';
        if (hasWords(value) && !isMarked(value)) {
          found.push(`${node.localName}[${attribute}] "${value}"`);
        }
      });
    } else if (
      node instanceof Text &&
      node.parentElement?.closest('script, style') === null
    ) {
      const text = node.data.trim();
      if (hasWords(text) && !isMarked(text)) {
        found.push(`${node.parentElement.localName} "${text}"`);
      }
    }
  }
  return found;
}

const englishMessages = readLocale('en');

/** What an English browser says for the names it gives itself */
const BROWSER_IN_ENGLISH: Record<string, string | undefined> = {
  '@@ui_locale': 'en',
  '@@bidi_dir': 'ltr',
  '@@bidi_reversed_dir': 'rtl',
  '@@bidi_start_edge': 'left',
  '@@bidi_end_edge': 'right',
};

/**
 * The browser's own messages in English, as it would give them: for a test that
 * wants the words, and fails when the code asks for a message that is not there.
 */
export function englishMessage(
  name: string,
  substitutions: readonly string[] = [],
): string {
  // The browser answers for its own names, which are not in the messages
  const own = BROWSER_IN_ENGLISH[name];
  if (own !== undefined) {
    return own;
  }
  const text = englishMessages[name];
  if (text === undefined) {
    throw new Error(`There is no English message ${name}`);
  }
  return substitutions.reduce(
    (result, substitution, index) =>
      result.replaceAll(`$${String(index + 1)}`, substitution),
    text,
  );
}
