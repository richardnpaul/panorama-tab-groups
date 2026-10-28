import { describe, expect, it } from 'vitest';
import {
  completenessOf,
  localeReport,
  parseLocale,
} from '../../../scripts/lib/locale-report.js';

const english = { a: 'A', b: 'B', c: 'C', d: 'D' };

describe('scripts/lib/locale-report.ts', () => {
  describe('parseLocale', () => {
    it('reads the message text of each name', () => {
      expect(
        parseLocale(
          'de',
          JSON.stringify({ a: { message: 'Eins' }, b: { message: 'Zwei' } }),
        ),
      ).toEqual({ a: 'Eins', b: 'Zwei' });
    });

    it('ignores the description of a message', () => {
      expect(
        parseLocale(
          'de',
          JSON.stringify({ a: { message: 'Eins', description: 'One' } }),
        ),
      ).toEqual({ a: 'Eins' });
    });

    it.each([['[]'], ['null'], ['"text"'], ['5']])(
      'fails naming the folder when the file holds %s and not messages',
      (text) => {
        expect(() => parseLocale('de', text)).toThrow(
          'de: messages.json is not an object',
        );
      },
    );

    it.each([
      ['no entry', { a: null }],
      ['a text and not an entry', { a: 'text' }],
      ['an entry without text', { a: {} }],
      ['an entry whose text is a number', { a: { message: 5 } }],
    ])('fails naming the message for %s', (_name, data) => {
      expect(() => parseLocale('de', JSON.stringify(data))).toThrow(
        'de: a has no message text',
      );
    });

    it('fails for text that is not JSON', () => {
      expect(() => parseLocale('de', '{')).toThrow();
    });
  });

  describe('completenessOf', () => {
    it('counts what each language has and lacks of English', () => {
      expect(
        completenessOf(english, {
          de: { a: '1', b: '2', c: '3', d: '4' },
          fr: { a: '1', c: '3' },
        }),
      ).toEqual([
        { folder: 'de', translated: 4, missing: 0 },
        { folder: 'fr', translated: 2, missing: 2 },
      ]);
    });

    it('does not count a message that English does not have', () => {
      expect(completenessOf(english, { de: { a: '1', extra: 'x' } })).toEqual([
        { folder: 'de', translated: 1, missing: 3 },
      ]);
    });

    it('puts the most complete first, and by name where they are as complete', () => {
      const result = completenessOf(english, {
        zh: { a: '1' },
        pl: { a: '1', b: '2' },
        de: { a: '1', b: '2' },
      });

      expect(result.map(({ folder }) => folder)).toEqual(['de', 'pl', 'zh']);
    });
  });

  describe('localeReport', () => {
    it('is a table with a row for each language', () => {
      const report = localeReport(english, {
        de: { a: '1', b: '2', c: '3', d: '4' },
        fr: { a: '1', c: '3' },
      });

      expect(report.split('\n')).toEqual([
        '## Translations',
        '',
        'English has 4 messages. A message a language lacks is shown in English.',
        '',
        '| Locale | Translated | Missing | Complete |',
        '| ------ | ---------- | ------- | -------- |',
        '| de | 4 | 0 | 100% |',
        '| fr | 2 | 2 | 50% |',
        '',
      ]);
    });

    it('rounds the share down, so that a language is not complete until it is', () => {
      const report = localeReport(
        { a: '1', b: '2', c: '3' },
        { de: { a: '1', b: '2' } },
      );

      expect(report).toContain('| de | 2 | 1 | 66% |');
    });
  });
});
