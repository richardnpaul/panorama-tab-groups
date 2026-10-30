// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatByteSize,
  getPluralForm,
  newElement,
} from '../../../src/js/share/utils.js';
import { markedMessage } from '../../support/messages.js';

const getMessage = vi.fn<(messageName: string) => string>();
const i18n = { getMessage };

describe('share/utils.ts', () => {
  describe('newElement', () => {
    it('creates an element with the given tag name', () => {
      expect(newElement('section', {}).tagName).toBe('SECTION');
    });

    it('sets each attribute on the element', () => {
      const el = newElement('div', { id: 'test-id', title: 'hello' });

      expect(el.getAttribute('id')).toBe('test-id');
      expect(el.getAttribute('title')).toBe('hello');
      expect(el.attributes).toHaveLength(2);
    });

    it('replaces every underscore in an attribute name with a hyphen', () => {
      const el = newElement('div', { data_one_two_three: 'x' });

      expect(el.getAttribute('data-one-two-three')).toBe('x');
      expect(el.attributes).toHaveLength(1);
    });

    it('converts numeric attribute values to strings', () => {
      const el = newElement('div', { tabindex: 3 });

      expect(el.getAttribute('tabindex')).toBe('3');
    });

    it('adds the content attribute as a text node, not an attribute', () => {
      const el = newElement('span', { content: 'hello world' });

      expect(el.attributes).toHaveLength(0);
      expect(el.childNodes).toHaveLength(1);
      expect(el.firstChild?.nodeType).toBe(Node.TEXT_NODE);
      expect(el.textContent).toBe('hello world');
    });

    it('converts numeric content to text', () => {
      expect(newElement('span', { content: 42 }).textContent).toBe('42');
    });

    it('treats only the exact name content as text', () => {
      const el = newElement('div', { contents: 'x' });

      expect(el.getAttribute('contents')).toBe('x');
      expect(el.childNodes).toHaveLength(0);
    });

    it('appends the children in order after the content', () => {
      const first = document.createElement('i');
      const second = document.createElement('b');

      const el = newElement('div', { content: 'text' }, [first, second]);

      expect(Array.from(el.childNodes)).toEqual([el.firstChild, first, second]);
      expect(el.firstChild?.textContent).toBe('text');
    });

    it('works without children and with an empty list of children', () => {
      expect(newElement('div', {}).childNodes).toHaveLength(0);
      expect(newElement('div', {}, []).childNodes).toHaveLength(0);
    });
  });

  describe('getPluralForm', () => {
    beforeEach(() => {
      getMessage.mockReset();
    });

    /** The browser says it is set to this language */
    const inLanguage = (locale: string) => {
      getMessage.mockReturnValue(locale);
    };

    it('asks the browser for the language it is set to', () => {
      inLanguage('en');

      getPluralForm(i18n, 1, 'one=a|other=b');

      expect(getMessage).toHaveBeenCalledTimes(1);
      expect(getMessage).toHaveBeenCalledWith('@@ui_locale');
    });

    it.each(['en', 'ru', 'ja', ''])(
      'returns a message with a single form unchanged in %j',
      (locale) => {
        inLanguage(locale);

        expect(getPluralForm(i18n, 5, 'single form')).toBe('single form');
      },
    );

    it('uses a count of 1 and an empty string by default', () => {
      inLanguage('en');

      expect(getPluralForm(i18n)).toBe('');
      expect(getPluralForm(i18n, undefined, 'one=a|other=b')).toBe('a');
    });

    it('accepts the count as a string', () => {
      inLanguage('en');

      expect(getPluralForm(i18n, '1', 'one=a|other=b')).toBe('a');
      expect(getPluralForm(i18n, '2', 'one=a|other=b')).toBe('b');
    });

    it('treats a count that is not a number as the form for the rest', () => {
      inLanguage('en');

      expect(getPluralForm(i18n, 'abc', 'one=a|other=b')).toBe('b');
    });

    it.each(['', '@@ui_locale', 'not a language'])(
      'counts as English does when the browser gives %j',
      (locale) => {
        inLanguage(locale);

        expect(getPluralForm(i18n, 1, 'one=a|other=b')).toBe('a');
        expect(getPluralForm(i18n, 2, 'one=a|other=b')).toBe('b');
      },
    );

    it('takes the language the way the browser writes it, with an underscore for a region', () => {
      inLanguage('pt_BR');

      // Brazilian Portuguese counts 0 as one, as French does
      expect(getPluralForm(i18n, 0, 'one=a|other=b')).toBe('a');
    });

    // The forms of a language, from its table of forms, for the counts that tell them apart
    it.each([
      ['en', 1, 'one'],
      ['en', 0, 'other'],
      ['en', 2, 'other'],
      ['fr', 0, 'one'],
      ['fr', 1, 'one'],
      ['fr', 2, 'other'],
      ['ru', 1, 'one'],
      ['ru', 21, 'one'],
      ['ru', 2, 'few'],
      ['ru', 24, 'few'],
      ['ru', 5, 'many'],
      ['ru', 11, 'many'],
      ['ru', 12, 'many'],
      ['ru', 0, 'many'],
      ['pl', 1, 'one'],
      ['pl', 3, 'few'],
      ['pl', 5, 'many'],
      ['pl', 22, 'few'],
      ['ar', 0, 'zero'],
      ['ar', 1, 'one'],
      ['ar', 2, 'two'],
      ['ar', 3, 'few'],
      ['ar', 11, 'many'],
      ['ar', 100, 'other'],
      ['ja', 1, 'other'],
      ['ja', 5, 'other'],
    ])('%s: %s takes the form for %s', (locale, count, form) => {
      inLanguage(locale);
      const message = 'zero=zero|one=one|two=two|few=few|many=many|other=other';

      expect(getPluralForm(i18n, count, message)).toBe(form);
    });
  });

  describe('formatByteSize', () => {
    /** The browser is set to this language, and gives each message as its name with what it was given */
    const inLanguage = (locale: string) => ({
      getMessage: (name: string, substitutions: readonly string[] = []) =>
        name === '@@ui_locale' ? locale : markedMessage(name, substitutions),
    });

    it.each([
      [0, 'byteSizeBytes', '0'],
      [500, 'byteSizeBytes', '500'],
      [1023, 'byteSizeBytes', '1,023'],
      [1024, 'byteSizeKiB', '1.000'],
      [1536, 'byteSizeKiB', '1.500'],
      [1048575, 'byteSizeKiB', '1,023.999'],
      [1048576, 'byteSizeMiB', '1.000'],
      [1610612736, 'byteSizeGiB', '1.500'],
      [1073741823, 'byteSizeMiB', '1,024.000'],
      [1073741824, 'byteSizeGiB', '1.000'],
      [5368709120, 'byteSizeGiB', '5.000'],
    ])('formats %s with the message %s and %s', (bytes, name, number) => {
      expect(formatByteSize(inLanguage('en'), bytes)).toBe(
        markedMessage(name, [number]),
      );
    });

    it('writes the number as the language of the browser does', () => {
      expect(formatByteSize(inLanguage('de'), 1536)).toBe(
        markedMessage('byteSizeKiB', ['1,500']),
      );
      expect(formatByteSize(inLanguage('fr'), 1536)).toBe(
        markedMessage('byteSizeKiB', ['1,500']),
      );
      expect(formatByteSize(inLanguage('pt_BR'), 1536)).toBe(
        markedMessage('byteSizeKiB', ['1,500']),
      );
    });

    it('writes it in English when the browser gives no language', () => {
      expect(formatByteSize(inLanguage(''), 1536)).toBe(
        markedMessage('byteSizeKiB', ['1.500']),
      );
      expect(formatByteSize(inLanguage('@@ui_locale'), 1536)).toBe(
        markedMessage('byteSizeKiB', ['1.500']),
      );
    });
  });
});
