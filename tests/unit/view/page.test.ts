import { describe, expect, it, vi } from 'vitest';
import { createPage } from '../../../src/js/view/page.js';

describe('view/page.ts', () => {
  const setUp = (hidden = false) => {
    const reload = vi.fn();
    const input = { value: '' };
    const doc = { hidden };
    const win = { innerWidth: 1280, innerHeight: 720, location: { reload } };
    return { page: createPage(doc, win, input), reload, input, doc, win };
  };

  it('says whether the page is hidden now', () => {
    const env = setUp(false);
    expect(env.page.isHidden()).toBe(false);

    const hidden = setUp(true);
    expect(hidden.page.isHidden()).toBe(true);
    hidden.doc.hidden = false;
    expect(hidden.page.isHidden()).toBe(false);
  });

  it('reloads the page', () => {
    const env = setUp();

    env.page.reload();

    expect(env.reload).toHaveBeenCalledTimes(1);
  });

  it('gives the size of the window now', () => {
    const env = setUp();

    expect(env.page.viewportSize()).toEqual({ width: 1280, height: 720 });
  });

  it('gives what is typed in the search box now', () => {
    const env = setUp();
    expect(env.page.searchText()).toBe('');

    env.input.value = 'tab';

    expect(env.page.searchText()).toBe('tab');
  });
});
