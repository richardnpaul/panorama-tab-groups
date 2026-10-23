// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatByteSize,
  getPluralForm,
  newElement,
} from '../../../src/js/share/utils.js';

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

    const withRule = (rule: string) => {
      getMessage.mockReturnValue(rule);
    };

    it('asks the translations for the plural rule of the current language', () => {
      withRule('1');

      getPluralForm(i18n, 1, 'a|b');

      expect(getMessage).toHaveBeenCalledTimes(1);
      expect(getMessage).toHaveBeenCalledWith('pluralRule');
    });

    it.each(['0', '1', '2', '7', '9', '999', ''])(
      'returns a string with a single form unchanged under rule %s',
      (rule) => {
        withRule(rule);

        expect(getPluralForm(i18n, 5, 'single form')).toBe('single form');
      },
    );

    it('uses a count of 1 and an empty string by default', () => {
      withRule('1');

      expect(getPluralForm(i18n)).toBe('');
      expect(getPluralForm(i18n, undefined, 'one|other')).toBe('one');
    });

    it('accepts the count as a string', () => {
      withRule('1');

      expect(getPluralForm(i18n, '1', 'one|other')).toBe('one');
      expect(getPluralForm(i18n, '2', 'one|other')).toBe('other');
    });

    it('treats a count that is not a number as not matching', () => {
      withRule('1');

      expect(getPluralForm(i18n, 'abc', 'one|other')).toBe('other');
    });

    it('returns the whole string for an unknown rule', () => {
      withRule('999');

      expect(getPluralForm(i18n, 5, 'form1|form2')).toBe('form1|form2');
    });

    it('returns the whole string when the rule is not a number', () => {
      withRule('');

      expect(getPluralForm(i18n, 5, 'form1|form2')).toBe('form1|form2');
    });

    it('rule 0 always uses the first form', () => {
      withRule('0');

      expect(getPluralForm(i18n, 0, 'form1|form2')).toBe('form1');
      expect(getPluralForm(i18n, 5, 'form1|form2')).toBe('form1');
    });

    it.each([
      [0, 'other'],
      [1, 'one'],
      [2, 'other'],
      [5, 'other'],
      [-1, 'other'],
    ])('rule 1: %s is %s', (count, form) => {
      withRule('1');

      expect(getPluralForm(i18n, count, 'one|other')).toBe(form);
    });

    it.each([
      [-1, 'one'],
      [0, 'one'],
      [1, 'one'],
      [2, 'other'],
      [5, 'other'],
    ])('rule 2: %s is %s', (count, form) => {
      withRule('2');

      expect(getPluralForm(i18n, count, 'one|other')).toBe(form);
    });

    it.each([
      [0, 'other'],
      [1, 'one'],
      [21, 'one'],
      [101, 'one'],
      [11, 'other'],
      [111, 'other'],
      [2, 'few'],
      [3, 'few'],
      [4, 'few'],
      [22, 'few'],
      [24, 'few'],
      [102, 'few'],
      [12, 'other'],
      [13, 'other'],
      [14, 'other'],
      [112, 'other'],
      [114, 'other'],
      [5, 'other'],
      [10, 'other'],
      [15, 'other'],
      [20, 'other'],
      [25, 'other'],
      [100, 'other'],
      [-1, 'other'],
      [-2, 'other'],
    ])('rule 7: %s is %s', (count, form) => {
      withRule('7');

      expect(getPluralForm(i18n, count, 'one|few|other')).toBe(form);
    });

    it.each([
      [0, 'other'],
      [1, 'one'],
      [21, 'other'],
      [101, 'other'],
      [11, 'other'],
      [2, 'few'],
      [3, 'few'],
      [4, 'few'],
      [22, 'few'],
      [24, 'few'],
      [102, 'few'],
      [12, 'other'],
      [13, 'other'],
      [14, 'other'],
      [112, 'other'],
      [5, 'other'],
      [20, 'other'],
      [100, 'other'],
      [-1, 'other'],
      [-2, 'other'],
    ])('rule 9: %s is %s', (count, form) => {
      withRule('9');

      expect(getPluralForm(i18n, count, 'one|few|other')).toBe(form);
    });

    it('returns undefined when the string lacks the needed form', () => {
      withRule('7');

      expect(getPluralForm(i18n, 5, 'one|few')).toBeUndefined();
    });
  });

  describe('formatByteSize', () => {
    it.each([
      [0, '0 bytes'],
      [500, '500 bytes'],
      [1023, '1023 bytes'],
      [1024, '1.000 KiB'],
      [1536, '1.500 KiB'],
      [1048575, '1023.999 KiB'],
      [1048576, '1.000 MiB'],
      [1610612736, '1.500 GiB'],
      [1073741823, '1024.000 MiB'],
      [1073741824, '1.000 GiB'],
      [5368709120, '5.000 GiB'],
    ])('formats %s as %s', (bytes, text) => {
      expect(formatByteSize(bytes)).toBe(text);
    });
  });
});
