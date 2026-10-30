import type { Locator, Page, TestInfo } from '@playwright/test';
import {
  CONTROL_CONTRAST,
  TEXT_CONTRAST,
  contrastRatio,
} from '../support/contrast.js';
import { test, expect } from './fixtures.js';

// What tokens.css gives the page, in the colours a browser reports for them
const SURFACE = { light: 'rgb(255, 255, 255)', dark: 'rgb(42, 42, 46)' };

/** Pick a choice by its label, which covers the radio button with a picture */
async function choose(page: Page, id: string): Promise<void> {
  await page.locator(`label[for="${id}"]`).click();
  await expect(page.locator(`#${id}`)).toBeChecked();
}

const colorOf = (locator: Locator, property: string): Promise<string> =>
  locator.evaluate(
    (element, name) => getComputedStyle(element).getPropertyValue(name),
    property,
  );

/** How far the page is wider than the window, which is what makes it scroll sideways */
const sidewaysOverflow = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

interface Measure {
  name: string;
  ratio: number;
  least: number;
}

/** What the page shows in the theme it has: text and the edges of controls against what they are on */
async function measureContrast(page: Page): Promise<Measure[]> {
  const surface = await colorOf(page.locator('body'), 'background-color');
  const field = page.locator('.keyboardShortcuts input').first();
  const button = page
    .locator('.keyboardShortcuts button.updateShortcut')
    .first();
  await field.focus();

  const text = async (
    name: string,
    element: Locator,
    background = surface,
  ): Promise<Measure> => ({
    name,
    ratio: contrastRatio(await colorOf(element, 'color'), background),
    least: TEXT_CONTRAST,
  });
  const edge = async (
    name: string,
    element: Locator,
    property: string,
  ): Promise<Measure> => ({
    name,
    ratio: contrastRatio(await colorOf(element, property), surface),
    least: CONTROL_CONTRAST,
  });

  const [fieldBackground, buttonBackground] = await Promise.all([
    colorOf(field, 'background-color'),
    colorOf(button, 'background-color'),
  ]);
  return Promise.all([
    text('page text', page.locator('body')),
    text('heading', page.locator('#optionsTheme h2')),
    text('link', page.locator('a').first()),
    text('information', page.locator('#nativeGroupsWarning')),
    text('text in a field', field, fieldBackground),
    text('text on a button', button, buttonBackground),
    edge('edge of a field', field, 'border-top-color'),
    edge('edge of a button', button, 'border-top-color'),
    edge('focus ring', field, 'outline-color'),
  ]);
}

/** Keep a picture of the page, for whoever reviews it */
async function keepPicture(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

/** The headings and the pictures of the choices must not be on top of one another */
async function overlappingParts(page: Page): Promise<string[]> {
  const boxes = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        'h2, h3, h4, .input-radio-image',
      ),
    ]
      .filter((element) => element.offsetParent !== null)
      .map((element) => {
        // What the contents take up, which is more than the box when the text overflows it
        const range = document.createRange();
        range.selectNodeContents(element);
        const { top, bottom, left, right } = range.getBoundingClientRect();
        const name = element.id || element.textContent.trim().slice(0, 30);
        return {
          name: `${element.localName} ${name}`,
          top,
          bottom,
          left,
          right,
        };
      }),
  );

  return boxes.flatMap((first, index) =>
    boxes
      .slice(index + 1)
      .filter(
        (second) =>
          first.top < second.bottom - 1 &&
          second.top < first.bottom - 1 &&
          first.left < second.right - 1 &&
          second.left < first.right - 1,
      )
      .map((second) => `${first.name} overlaps ${second.name}`),
  );
}

test.describe('Options page theme and layout', () => {
  test.beforeEach(async ({ page, extensionId, extensionProtocol }) => {
    await page.goto(`${extensionProtocol}://${extensionId}/options.html`);
    await expect(
      page.locator('form[name="formTheme"] input:checked'),
    ).toHaveCount(1, { timeout: 15000 });
  });

  test.describe('follows the theme chosen on the page', () => {
    test('Dark makes the page dark and Light makes it light, with no reload', async ({
      page,
    }) => {
      const body = page.locator('body');

      await choose(page, 'themeDark');
      await expect(body).toHaveClass(/theme-dark/);
      await expect(body).toHaveCSS('background-color', SURFACE.dark);

      await choose(page, 'themeLight');
      await expect(body).toHaveClass(/theme-light/);
      await expect(body).not.toHaveClass(/theme-dark/);
      await expect(body).toHaveCSS('background-color', SURFACE.light);
    });

    test('Follow System takes the colour setting of the browser, and follows it when it changes', async ({
      page,
    }) => {
      const body = page.locator('body');
      await choose(page, 'themeAuto');

      await page.emulateMedia({ colorScheme: 'dark' });
      await expect(body).toHaveClass(/theme-dark/);
      await expect(body).toHaveCSS('background-color', SURFACE.dark);

      await page.emulateMedia({ colorScheme: 'light' });
      await expect(body).toHaveClass(/theme-light/);
      await expect(body).toHaveCSS('background-color', SURFACE.light);
    });

    test('a chosen theme is not changed by the system', async ({ page }) => {
      await choose(page, 'themeLight');
      await page.emulateMedia({ colorScheme: 'dark' });

      await expect(page.locator('body')).toHaveClass(/theme-light/);
      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        SURFACE.light,
      );
    });
  });

  test.describe('contrast', () => {
    (
      [
        ['light', 'themeLight'],
        ['dark', 'themeDark'],
      ] as const
    ).forEach(([theme, id]) => {
      test(`the ${theme} theme meets WCAG AA`, async ({ page }, testInfo) => {
        await choose(page, id);
        await expect(page.locator('body')).toHaveCSS(
          'background-color',
          SURFACE[theme],
        );
        await keepPicture(page, testInfo, `options-${theme}`);

        const measures = await measureContrast(page);

        const failing = measures
          .filter(({ ratio, least }) => ratio < least)
          .map(
            ({ name, ratio, least }) =>
              `${name}: ${ratio.toFixed(2)}, needs ${String(least)}`,
          );
        expect(failing).toEqual([]);
        expect(measures).toHaveLength(9);
      });
    });
  });

  test.describe('layout', () => {
    [320, 800, 1600].forEach((width) => {
      test(`holds at ${String(width)}px: no sideways scrolling, no overlap, every shortcut field in view`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });

        expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);
        expect(await overlappingParts(page)).toEqual([]);

        const fields = page.locator('.keyboardShortcuts input');
        const count = await fields.count();
        expect(count).toBeGreaterThan(0);
        const boxes = await Promise.all(
          Array.from({ length: count }, (_, index) =>
            fields.nth(index).boundingBox(),
          ),
        );
        const outside = boxes.flatMap((box, index) =>
          box !== null && box.x >= 0 && box.x + box.width <= width
            ? []
            : [`field ${String(index)}`],
        );
        expect(outside).toEqual([]);
      });
    });

    test('mirrors for a right-to-left language, still without sideways scrolling', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(() => {
        document.documentElement.dir = 'rtl';
      });
      expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

      // With room for both in a row the label comes first, so it is on the right
      await page.setViewportSize({ width: 800, height: 900 });
      const [label, field] = await Promise.all([
        page.locator('#activate-next-group label').boundingBox(),
        page.locator('#activate-next-group input').boundingBox(),
      ]);
      expect(label).not.toBeNull();
      expect(field).not.toBeNull();
      expect(label?.x ?? 0).toBeGreaterThan(field?.x ?? Infinity);
    });
  });
});
