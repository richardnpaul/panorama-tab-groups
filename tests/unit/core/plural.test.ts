import { describe, expect, it } from 'vitest';
import {
  PLURAL_CATEGORIES,
  pluralCategory,
  pluralForms,
  selectPluralForm,
} from '../../../src/js/core/plural.js';

describe('core/plural.ts', () => {
  describe('PLURAL_CATEGORIES', () => {
    it('are the six forms of the Unicode CLDR', () => {
      expect(PLURAL_CATEGORIES).toEqual([
        'zero',
        'one',
        'two',
        'few',
        'many',
        'other',
      ]);
    });
  });

  describe('pluralForms', () => {
    it('reads each labelled part of a message', () => {
      expect(pluralForms('one=$1 tab|other=$1 tabs')).toEqual({
        one: '$1 tab',
        other: '$1 tabs',
      });
    });

    it('reads all six labels', () => {
      expect(pluralForms('zero=a|one=b|two=c|few=d|many=e|other=f')).toEqual({
        zero: 'a',
        one: 'b',
        two: 'c',
        few: 'd',
        many: 'e',
        other: 'f',
      });
    });

    it('keeps an equals sign in the text of a form', () => {
      expect(pluralForms('one=a = b|other=c')).toEqual({
        one: 'a = b',
        other: 'c',
      });
    });

    it('keeps a new line in the text of a form', () => {
      expect(pluralForms('one=a\nb|other=c')).toEqual({
        one: 'a\nb',
        other: 'c',
      });
    });

    it('reads one labelled part', () => {
      expect(pluralForms('other=all')).toEqual({ other: 'all' });
    });

    it('has no forms for a message without labels', () => {
      expect(pluralForms('just text')).toBeUndefined();
      expect(pluralForms('')).toBeUndefined();
      expect(pluralForms('a|b')).toBeUndefined();
    });

    it('has no forms for a message where only some parts are labelled', () => {
      expect(pluralForms('one=a|b')).toBeUndefined();
      expect(pluralForms('a|other=b')).toBeUndefined();
    });

    it('does not take a word that only starts like a label', () => {
      expect(pluralForms('oneself=a')).toBeUndefined();
      expect(pluralForms('some one=a')).toBeUndefined();
      expect(pluralForms('ONE=a')).toBeUndefined();
      expect(pluralForms('few =a')).toBeUndefined();
    });
  });

  describe('pluralCategory', () => {
    it.each([
      ['en', 1, 'one'],
      ['en', 0, 'other'],
      ['en-GB', 1, 'one'],
      ['pt_BR', 0, 'one'],
      ['pt_BR', 2, 'other'],
      ['fr', 0, 'one'],
      ['ru', 21, 'one'],
      ['ru', 3, 'few'],
      ['ru', 0, 'many'],
      ['pl', 4, 'few'],
      ['ar', 2, 'two'],
      ['ja', 1, 'other'],
    ] as const)('%s: %s is %s', (locale, count, category) => {
      expect(pluralCategory(locale, count)).toBe(category);
    });

    it.each(['', '@@ui_locale', 'not a language', 'x'])(
      'counts as English does for %j, which is not a language',
      (locale) => {
        expect(pluralCategory(locale, 1)).toBe('one');
        expect(pluralCategory(locale, 2)).toBe('other');
      },
    );

    it('answers for a count that is not a number', () => {
      expect(pluralCategory('en', Number.NaN)).toBe('other');
    });
  });

  describe('selectPluralForm', () => {
    it('is the form for the category', () => {
      const message = 'one=a|few=b|many=c';

      expect(selectPluralForm(message, 'one')).toBe('a');
      expect(selectPluralForm(message, 'few')).toBe('b');
      expect(selectPluralForm(message, 'many')).toBe('c');
    });

    it('is the form for "other" where there is none for the category', () => {
      expect(selectPluralForm('one=a|other=z', 'few')).toBe('z');
      expect(selectPluralForm('one=a|other=z', 'zero')).toBe('z');
    });

    it('prefers the form of the category to "other"', () => {
      expect(selectPluralForm('other=z|one=a', 'one')).toBe('a');
    });

    it('is the message itself when it has one form, whatever the category', () => {
      expect(selectPluralForm('all of them', 'one')).toBe('all of them');
      expect(selectPluralForm('all of them', 'many')).toBe('all of them');
    });

    it('is the message as it was written when it has forms but none fits, so that the mistake shows', () => {
      expect(selectPluralForm('one=a|few=b', 'many')).toBe('one=a|few=b');
    });

    it('is the message as it was written when only some parts are labelled', () => {
      expect(selectPluralForm('one=a|b', 'one')).toBe('one=a|b');
    });
  });
});
