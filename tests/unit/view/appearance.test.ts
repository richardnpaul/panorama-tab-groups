// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAppearance } from '../../../src/js/view/theme.js';
import {
  createImageLoader,
  createThumbnailShrinker,
  type CanvasLike,
  type ImageLike,
} from '../../../src/js/view/thumbnail-image.js';

function fakeImage(width = 1000, height = 500) {
  const image: ImageLike = {
    src: '',
    width,
    height,
    onload: null,
    onerror: null,
  };
  return image;
}

describe('view/thumbnail-image.ts', () => {
  describe('createThumbnailShrinker', () => {
    const setUp = (surface = true) => {
      const image = fakeImage(1000, 500);
      const draw = vi.fn();
      const canvas: CanvasLike<ImageLike> = {
        width: 0,
        height: 0,
        getContext: () => (surface ? { drawImage: draw } : null),
        toDataURL: vi.fn(() => 'data:image/jpeg;base64,small'),
      };
      return {
        shrink: createThumbnailShrinker({
          newImage: () => image,
          newCanvas: () => canvas,
        }),
        image,
        canvas,
        draw,
      };
    };

    it('loads the picture, draws it 500 pixels wide in proportion, and gives a JPEG of it', async () => {
      const env = setUp();
      const shrinking = env.shrink('data:image/jpeg;base64,big');
      expect(env.image.src).toBe('data:image/jpeg;base64,big');

      env.image.onload?.(new Event('load'));

      await expect(shrinking).resolves.toBe('data:image/jpeg;base64,small');
      expect(env.canvas.width).toBe(500);
      expect(env.canvas.height).toBe(250);
      expect(env.draw).toHaveBeenCalledWith(env.image, 0, 0, 500, 250);
      expect(env.canvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
    });

    it('does nothing with the picture until it has loaded', () => {
      const env = setUp();

      env.shrink('data:x').catch(() => undefined);

      expect(env.draw).not.toHaveBeenCalled();
    });

    it('fails when the picture cannot be loaded', async () => {
      const env = setUp();
      const shrinking = env.shrink('data:x');

      env.image.onerror?.(new Event('error'));

      await expect(shrinking).rejects.toThrow(
        'The picture of the tab could not be loaded',
      );
    });

    it('fails where a canvas cannot be drawn on', async () => {
      const env = setUp(false);
      const shrinking = env.shrink('data:x');

      env.image.onload?.(new Event('load'));

      await expect(shrinking).rejects.toThrow(
        'A canvas cannot be drawn on here',
      );
    });
  });

  describe('createImageLoader', () => {
    it('settles when the picture has loaded', async () => {
      const image = fakeImage();
      const load = createImageLoader(() => image);
      const loading = load('https://a/i.png');
      expect(image.src).toBe('https://a/i.png');

      image.onload?.(new Event('load'));

      await expect(loading).resolves.toBeUndefined();
    });

    it('fails, naming the picture, when it cannot be loaded', async () => {
      const image = fakeImage();
      const load = createImageLoader(() => image);
      const loading = load('https://a/i.png');

      image.onerror?.(new Event('error'));

      await expect(loading).rejects.toThrow(
        'The image https://a/i.png could not be loaded',
      );
    });
  });
});

describe('view/theme.ts', () => {
  const bodyOf = (...classes: string[]) => {
    const element = document.createElement('body');
    element.classList.add(...classes);
    return element;
  };

  function setUp({
    stored = { useDarkTheme: false, theme: 'auto', toolbarPosition: 'top' },
    dark = false,
    classes = [],
  }: {
    stored?: { useDarkTheme: boolean; theme: string; toolbarPosition: string };
    dark?: boolean;
    classes?: string[];
  } = {}) {
    const body = bodyOf(...classes);
    let systemListener: () => void = () => undefined;
    const systemPrefersDark = {
      matches: dark,
      addEventListener: vi.fn((_type: 'change', listener: () => void) => {
        systemListener = listener;
      }),
    };
    let changeListener: (changes: {
      theme?: string;
      toolbarPosition?: string;
    }) => void = () => undefined;
    const settings = {
      read: vi.fn().mockResolvedValue(stored),
      saveDarkTheme: vi.fn().mockResolvedValue(undefined),
      onChange: vi.fn((listener: typeof changeListener) => {
        changeListener = listener;
      }),
    };
    return {
      apply: () => applyAppearance({ body, systemPrefersDark, settings }),
      body,
      settings,
      systemPrefersDark,
      changeSystem: (nowDark: boolean) => {
        Object.defineProperty(systemPrefersDark, 'matches', {
          value: nowDark,
          configurable: true,
        });
        systemListener();
      },
      change: (changes: { theme?: string; toolbarPosition?: string }) => {
        changeListener(changes);
      },
    };
  }

  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('dresses the page in the theme and toolbar position stored', async () => {
    const env = setUp({
      stored: { useDarkTheme: false, theme: 'light', toolbarPosition: 'left' },
    });

    await env.apply();

    expect(Array.from(env.body.classList)).toEqual([
      'theme-light',
      'toolbar-left',
    ]);
  });

  it('follows the system for the theme auto', async () => {
    const dark = setUp({ dark: true });
    const light = setUp({ dark: false });

    await dark.apply();
    await light.apply();

    expect(dark.body.classList.contains('theme-dark')).toBe(true);
    expect(light.body.classList.contains('theme-light')).toBe(true);
  });

  it('takes the place of the classes of the theme and the toolbar that were there', async () => {
    const env = setUp({
      classes: ['view-ready', 'theme-dark', 'toolbar-top', 'theme-extra'],
      stored: {
        useDarkTheme: false,
        theme: 'light',
        toolbarPosition: 'bottom',
      },
    });

    await env.apply();

    expect(Array.from(env.body.classList).sort()).toEqual([
      'theme-light',
      'toolbar-bottom',
      'view-ready',
    ]);
  });

  it('turns the setting of the old dark theme into the dark theme, and remembers it', async () => {
    const env = setUp({
      stored: { useDarkTheme: true, theme: 'light', toolbarPosition: 'top' },
    });

    await env.apply();

    expect(env.settings.saveDarkTheme).toHaveBeenCalledTimes(1);
    expect(env.body.classList.contains('theme-dark')).toBe(true);
    expect(env.body.classList.contains('theme-light')).toBe(false);
  });

  it('leaves the stored theme alone when the old setting is off', async () => {
    const env = setUp();

    await env.apply();

    expect(env.settings.saveDarkTheme).not.toHaveBeenCalled();
  });

  it('changes with the system while the theme is auto', async () => {
    const env = setUp({ dark: false });
    await env.apply();

    env.changeSystem(true);

    expect(env.body.classList.contains('theme-dark')).toBe(true);
    expect(env.body.classList.contains('theme-light')).toBe(false);
  });

  it('does not change with the system when the theme is another', async () => {
    const env = setUp({
      stored: { useDarkTheme: false, theme: 'light', toolbarPosition: 'top' },
    });
    await env.apply();

    env.changeSystem(true);

    expect(env.body.classList.contains('theme-light')).toBe(true);
  });

  it('listens to the system for changes', async () => {
    const env = setUp();

    await env.apply();

    expect(env.systemPrefersDark.addEventListener).toHaveBeenCalledWith(
      'change',
      expect.any(Function),
    );
  });

  it('changes the theme when the user does', async () => {
    const env = setUp();
    await env.apply();

    env.change({ theme: 'dark' });

    expect(env.body.classList.contains('theme-dark')).toBe(true);
  });

  it('follows the system again when the theme is changed to auto', async () => {
    const env = setUp({
      stored: { useDarkTheme: false, theme: 'light', toolbarPosition: 'top' },
    });
    await env.apply();

    env.change({ theme: 'auto' });
    env.changeSystem(true);

    expect(env.body.classList.contains('theme-dark')).toBe(true);
  });

  it('stops following the system when the theme is changed from auto', async () => {
    const env = setUp({ dark: false });
    await env.apply();
    env.change({ theme: 'light' });

    env.changeSystem(true);

    expect(env.body.classList.contains('theme-light')).toBe(true);
  });

  it('moves the toolbar when the user does', async () => {
    const env = setUp();
    await env.apply();

    env.change({ toolbarPosition: 'left' });

    expect(env.body.classList.contains('toolbar-left')).toBe(true);
    expect(env.body.classList.contains('toolbar-top')).toBe(false);
  });

  it('changes nothing for a change of something else', async () => {
    const env = setUp();
    await env.apply();
    const before = Array.from(env.body.classList);

    env.change({});

    expect(Array.from(env.body.classList)).toEqual(before);
  });

  it('changes both when both change', async () => {
    const env = setUp();
    await env.apply();

    env.change({ theme: 'dark', toolbarPosition: 'bottom' });

    expect(env.body.classList.contains('theme-dark')).toBe(true);
    expect(env.body.classList.contains('toolbar-bottom')).toBe(true);
  });
});
