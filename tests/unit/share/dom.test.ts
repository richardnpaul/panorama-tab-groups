// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  asListener,
  findElement,
  requireElement,
  requireElementById,
} from '../../../src/js/share/dom.js';

describe('share/dom.ts', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="outer"><span id="inner" class="item">x</span></div>
      <input id="field" name="theme" type="radio" value="dark" checked />
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('requireElement', () => {
    it('returns the element matching the selector', () => {
      expect(requireElement(HTMLSpanElement, '#inner')).toBe(
        document.getElementById('inner'),
      );
    });

    it('returns the first match when several elements match', () => {
      document.body.insertAdjacentHTML('beforeend', '<i class="item"></i>');

      expect(requireElement(Element, '.item').id).toBe('inner');
    });

    it('returns the element typed as the class that was asked for', () => {
      const input = requireElement(
        HTMLInputElement,
        'input[name="theme"]:checked',
      );

      expect(input.value).toBe('dark');
    });

    it('searches inside the given root', () => {
      const outer = requireElement(HTMLDivElement, '#outer');

      expect(requireElement(Element, 'span', outer).id).toBe('inner');
    });

    it('searches the whole document by default', () => {
      expect(requireElement(Element, 'input').getAttribute('name')).toBe(
        'theme',
      );
    });

    it('throws naming the selector when nothing matches', () => {
      expect(() => requireElement(Element, '#missing')).toThrow(
        new Error('Element not found: #missing'),
      );
    });

    it('does not find an element outside the given root', () => {
      const outer = requireElement(HTMLDivElement, '#outer');

      expect(() => requireElement(Element, 'input', outer)).toThrow(
        new Error('Element not found: input'),
      );
    });

    it('throws naming the class when the element is of another type', () => {
      expect(() => requireElement(HTMLInputElement, '#inner')).toThrow(
        new Error('Element is not an HTMLInputElement: #inner'),
      );
    });
  });

  describe('requireElementById', () => {
    it('returns the element with that id', () => {
      expect(requireElementById(HTMLDivElement, 'outer')).toBe(
        document.getElementById('outer'),
      );
    });

    it('returns the element typed as the class that was asked for', () => {
      expect(requireElementById(HTMLInputElement, 'field').value).toBe('dark');
    });

    it('throws naming the id when there is no such element', () => {
      expect(() => requireElementById(HTMLElement, 'missing')).toThrow(
        new Error('Element not found: #missing'),
      );
    });

    it('throws naming the class when the element is of another type', () => {
      expect(() => requireElementById(HTMLInputElement, 'outer')).toThrow(
        new Error('Element is not an HTMLInputElement: #outer'),
      );
    });
  });

  describe('findElement', () => {
    it('returns the element matching the selector and class', () => {
      expect(findElement(HTMLSpanElement, '#inner')).toBe(
        document.getElementById('inner'),
      );
    });

    it('returns null when nothing matches', () => {
      expect(findElement(Element, '#missing')).toBeNull();
    });

    it('returns null when the match is of another type', () => {
      expect(findElement(HTMLInputElement, '#inner')).toBeNull();
    });

    it('searches inside the given root', () => {
      const outer = requireElement(HTMLDivElement, '#outer');

      expect(findElement(Element, 'span', outer)).toBe(
        document.getElementById('inner'),
      );
      expect(findElement(Element, 'input', outer)).toBeNull();
    });

    it('searches the whole document by default', () => {
      expect(findElement(HTMLInputElement, 'input')?.value).toBe('dark');
    });
  });

  describe('asListener', () => {
    it('passes the event to the handler', () => {
      const handler = vi.fn().mockResolvedValue(undefined);
      const event = new Event('click');

      asListener(handler)(event);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('returns nothing, so the browser never waits on the handler', () => {
      const listener = asListener(() => Promise.resolve('done'));

      const asUnknown: (event: Event) => unknown = listener;

      expect(asUnknown(new Event('click'))).toBeUndefined();
    });

    it('logs a handler failure instead of leaving it unhandled', async () => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error('boom');

      asListener(() => Promise.reject(failure))(new Event('click'));
      await Promise.resolve();
      await Promise.resolve();

      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        '[Options] Event handler failed:',
        failure,
      );
      error.mockRestore();
    });

    it('stays quiet when the handler succeeds', async () => {
      const error = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      asListener(() => Promise.resolve())(new Event('click'));
      await Promise.resolve();
      await Promise.resolve();

      expect(error).not.toHaveBeenCalled();
      error.mockRestore();
    });
  });
});
