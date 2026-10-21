import {
  newElement,
  getPluralForm,
  formatByteSize,
} from '../../../src/js/share/utils.js';

describe('share/utils.js', () => {
  beforeEach(() => {
    global.document = {
      createElement: jest.fn((tag) => ({
        tagName: tag.toUpperCase(),
        appendChild: jest.fn(),
        setAttribute: jest.fn(),
      })),
      createTextNode: jest.fn((text) => ({ textContent: text })),
    };
  });

  describe('newElement', () => {
    it('creates element with basic attributes', () => {
      const el = newElement('div', { id: 'test-id', class_name: 'test' });
      expect(global.document.createElement).toHaveBeenCalledWith('div');
      expect(el.setAttribute).toHaveBeenCalledWith('id', 'test-id');
      expect(el.setAttribute).toHaveBeenCalledWith('class-name', 'test');
    });

    it('creates element with text content', () => {
      const el = newElement('span', { content: 'hello world' });
      expect(global.document.createTextNode).toHaveBeenCalledWith(
        'hello world',
      );
      expect(el.appendChild).toHaveBeenCalled();
    });

    it('appends children to element', () => {
      const child1 = { child: 1 };
      const child2 = { child: 2 };
      const el = newElement('div', {}, [child1, child2]);
      expect(el.appendChild).toHaveBeenCalledWith(child1);
      expect(el.appendChild).toHaveBeenCalledWith(child2);
    });
  });

  describe('getPluralForm', () => {
    beforeEach(() => {
      global.browser = {
        i18n: {
          getMessage: jest.fn(),
        },
      };
    });

    it('returns original string if only one form provided', () => {
      expect(getPluralForm(5, 'single form')).toBe('single form');
    });

    it('handles rule 0', () => {
      global.browser.i18n.getMessage.mockReturnValue('0');
      expect(getPluralForm(5, 'form1|form2')).toBe('form1');
    });

    it('handles rule 1', () => {
      global.browser.i18n.getMessage.mockReturnValue('1');
      expect(getPluralForm(1, 'one|other')).toBe('one');
      expect(getPluralForm(2, 'one|other')).toBe('other');
      expect(getPluralForm(5, 'one|other')).toBe('other');
    });

    it('handles rule 2', () => {
      global.browser.i18n.getMessage.mockReturnValue('2');
      expect(getPluralForm(0, 'one|other')).toBe('one');
      expect(getPluralForm(1, 'one|other')).toBe('one');
      expect(getPluralForm(2, 'one|other')).toBe('other');
      expect(getPluralForm(5, 'one|other')).toBe('other');
    });

    it('handles rule 7', () => {
      global.browser.i18n.getMessage.mockReturnValue('7');
      expect(getPluralForm(1, 'one|few|other')).toBe('one');
      expect(getPluralForm(21, 'one|few|other')).toBe('one'); // ends in 1, not 11
      expect(getPluralForm(11, 'one|few|other')).toBe('other'); // 11 is 'other'

      expect(getPluralForm(2, 'one|few|other')).toBe('few');
      expect(getPluralForm(4, 'one|few|other')).toBe('few');
      expect(getPluralForm(22, 'one|few|other')).toBe('few'); // ends in 2
      expect(getPluralForm(12, 'one|few|other')).toBe('other'); // 12 is 'other'

      expect(getPluralForm(5, 'one|few|other')).toBe('other');
    });

    it('handles rule 9', () => {
      global.browser.i18n.getMessage.mockReturnValue('9');
      expect(getPluralForm(1, 'one|few|other')).toBe('one');
      expect(getPluralForm(21, 'one|few|other')).toBe('other'); // exactly 1, so 21 is 'other'

      expect(getPluralForm(2, 'one|few|other')).toBe('few');
      expect(getPluralForm(4, 'one|few|other')).toBe('few');
      expect(getPluralForm(22, 'one|few|other')).toBe('few'); // ends in 2
      expect(getPluralForm(12, 'one|few|other')).toBe('other'); // 12 is 'other'

      expect(getPluralForm(5, 'one|few|other')).toBe('other');
    });

    it('handles default fallback', () => {
      global.browser.i18n.getMessage.mockReturnValue('999'); // Unknown rule
      expect(getPluralForm(5, 'form1|form2')).toBe('form1|form2');
    });

    it('handles default arguments', () => {
      global.browser.i18n.getMessage.mockReturnValue('1');
      expect(getPluralForm()).toBe('');
    });
  });

  describe('formatByteSize', () => {
    it('formats bytes', () => {
      expect(formatByteSize(500)).toBe('500 bytes');
    });

    it('formats KiB', () => {
      expect(formatByteSize(1024)).toBe('1.000 KiB');
      expect(formatByteSize(1024 * 1024 - 1)).toBe('1023.999 KiB');
    });

    it('formats MiB', () => {
      expect(formatByteSize(1024 * 1024)).toBe('1.000 MiB');
      expect(formatByteSize(1024 * 1024 * 1024 - 1)).toBe('1024.000 MiB');
    });

    it('formats GiB', () => {
      expect(formatByteSize(1024 * 1024 * 1024)).toBe('1.000 GiB');
    });
  });
});
