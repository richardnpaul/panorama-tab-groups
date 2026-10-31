import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CONTROL_CONTRAST,
  TEXT_CONTRAST,
  contrastRatio,
} from '../../support/contrast.js';

const read = (path: string): string => readFileSync(path, 'utf8');

interface Pair {
  light: string;
  dark: string;
}

/** The tokens of tokens.css: --name: light-dark(a, b); or --name: a; */
function readTokens(css: string): Record<string, Pair> {
  const tokens: Record<string, Pair> = {};
  for (const [, name = '', value = ''] of css.matchAll(
    /^\s*--([a-z-]+):\s*([^;]+);/gmu,
  )) {
    const pair = /^light-dark\(\s*([^,]+),\s*([^)]+)\)$/u.exec(value.trim());
    tokens[name] = pair
      ? { light: pair[1] ?? '', dark: pair[2] ?? '' }
      : { light: value.trim(), dark: value.trim() };
  }
  return tokens;
}

const tokens = readTokens(read('src/css/tokens.css'));
const token = (name: string): Pair => {
  const found = tokens[name];
  if (found === undefined) {
    throw new Error(`tokens.css has no --${name}`);
  }
  return found;
};

describe('tokens.css', () => {
  it('reads every token it defines', () => {
    expect(Object.keys(tokens).sort()).toEqual(
      [
        'accent',
        'border',
        'control',
        'control-active',
        'control-hover',
        'error',
        'info',
        'input',
        'separator',
        'surface',
        'text',
        'warning',
      ].sort(),
    );
  });

  // [foreground, background, the least ratio WCAG 2.2 AA asks for]
  const pairs: [string, string, number][] = [
    ['text', 'surface', TEXT_CONTRAST],
    ['text', 'input', TEXT_CONTRAST],
    ['text', 'control', TEXT_CONTRAST],
    ['text', 'control-hover', TEXT_CONTRAST],
    ['text', 'control-active', TEXT_CONTRAST],
    ['info', 'surface', TEXT_CONTRAST],
    ['warning', 'surface', TEXT_CONTRAST],
    ['error', 'surface', TEXT_CONTRAST],
    ['border', 'surface', CONTROL_CONTRAST],
    ['accent', 'surface', CONTROL_CONTRAST],
  ];

  describe.each(['light', 'dark'] as const)('the %s theme', (theme) => {
    it.each(pairs)(
      '--%s on --%s is at least %s:1',
      (foreground, background, least) => {
        const ratio = contrastRatio(
          token(foreground)[theme],
          token(background)[theme],
        );
        expect(ratio).toBeGreaterThanOrEqual(least);
      },
    );
  });

  it('follows the system until the page has its theme class, so a page does not start in the wrong one', () => {
    const css = read('src/css/tokens.css');

    expect(css).toMatch(/:root\s*\{\s*color-scheme:\s*light dark;/u);
    expect(css).toMatch(
      /:root:has\(> body\.theme-light\)\s*\{\s*color-scheme:\s*light;/u,
    );
    expect(css).toMatch(
      /:root:has\(> body\.theme-dark\)\s*\{\s*color-scheme:\s*dark;/u,
    );
  });

  it('is linked before the sheets that use it', () => {
    const links = [
      ...read('src/options.html').matchAll(/href="(css\/[a-z-]+\.css)"/gu),
    ].map(([, href]) => href);

    expect(links).toEqual([
      'css/tokens.css',
      'css/options.css',
      'css/browser-style.css',
    ]);
  });

  it('is the only place of the options page that names a colour', () => {
    const colour = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|\blight-dark\(/giu;
    const sources = {
      'src/css/options.css': read('src/css/options.css'),
      'src/css/browser-style.css': read('src/css/browser-style.css'),
      // a style attribute is a stylesheet too
      'src/options.html': read('src/options.html'),
    };

    const offenders = Object.entries(sources).flatMap(([file, text]) =>
      [...text.matchAll(colour)].map(([found]) => `${file}: ${found}`),
    );

    expect(offenders).toEqual([]);
  });
});
