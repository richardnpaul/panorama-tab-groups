/** The forms a language can have for a count, as the Unicode CLDR names them */
export const PLURAL_CATEGORIES = [
  'zero',
  'one',
  'two',
  'few',
  'many',
  'other',
] as const;

export type PluralCategory = (typeof PLURAL_CATEGORIES)[number];

// The language the forms of a message are chosen by when the browser's own is not one
const FALLBACK_LANGUAGE = 'en';

const isPluralCategory = (value: string | undefined): value is PluralCategory =>
  PLURAL_CATEGORIES.some((category) => category === value);

/**
 * The forms of a message that has them: "one=$1 tab|other=$1 tabs". A message
 * where no part is labelled has one form, for every count; so does one where
 * only some parts are, which a check of the translations reports.
 */
export function pluralForms(
  message: string,
): Partial<Record<PluralCategory, string>> | undefined {
  const parts = message.split('|');
  const forms = parts.flatMap((part) => {
    const [label, ...text] = part.split('=');
    return isPluralCategory(label) ? [[label, text.join('=')] as const] : [];
  });
  return forms.length === parts.length ? Object.fromEntries(forms) : undefined;
}

/** Which form a language uses for a count, in the language tag the browser gives (`pt_BR` or `pt-BR`) */
export function pluralCategory(locale: string, count: number): PluralCategory {
  const select = (language: string): PluralCategory =>
    new Intl.PluralRules(language).select(count);
  try {
    return select(locale.replaceAll('_', '-'));
  } catch {
    // Not a language tag, as a browser that gives no answer shows
    return select(FALLBACK_LANGUAGE);
  }
}

/**
 * The text of the form that fits the count: the one for its category, else the
 * one for "other". A message with one form is that form; a message that has
 * forms but none that fits is shown as it is, so that the mistake can be seen.
 */
export function selectPluralForm(
  message: string,
  category: PluralCategory,
): string {
  const forms = pluralForms(message);
  if (forms === undefined) {
    return message;
  }
  return forms[category] ?? forms.other ?? message;
}
