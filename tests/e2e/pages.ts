import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures.js';

/** Where the element is on the page; it fails for one that is not shown */
export async function boxOf(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) {
    throw new Error('The element is not shown');
  }
  return box;
}

/** How far the page is wider than the window, which is what makes it scroll sideways */
export const sidewaysOverflow = (page: Page): Promise<number> =>
  page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );

/**
 * The pairs of texts on the page that are written over each other: the text of one is where the text of
 * another is, which is what a label does that is longer than the room it was given. The part of a text that
 * is on a line is what is measured, and a hidden text or a pair that only touch is not counted.
 */
export const overlappingTexts = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const found: { text: string; box: DOMRect }[] = [];
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (
      let node = walker.nextNode();
      node !== null;
      node = walker.nextNode()
    ) {
      const text = (node.textContent ?? '').trim();
      const element = node.parentElement;
      const style = element === null ? undefined : getComputedStyle(element);
      const shown =
        text !== '' &&
        style !== undefined &&
        style.visibility !== 'hidden' &&
        style.display !== 'none';
      if (shown) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) {
          if (box.width > 1 && box.height > 1) {
            found.push({ text, box });
          }
        }
      }
    }
    const overlaps: string[] = [];
    found.forEach((first, index) => {
      found.slice(index + 1).forEach((second) => {
        const across =
          Math.min(first.box.right, second.box.right) -
          Math.max(first.box.left, second.box.left);
        const down =
          Math.min(first.box.bottom, second.box.bottom) -
          Math.max(first.box.top, second.box.top);
        if (across > 2 && down > 2 && first.text !== second.text) {
          overlaps.push(`${first.text} | ${second.text}`);
        }
      });
    });
    return overlaps;
  });

/** Make a group in the popup, which asks for its name in the second frame */
async function makeGroup(page: Page, name: string): Promise<void> {
  await page.locator('#main-frame .button-ghost--new').click();
  await page.bringToFront();
  const input = page.locator('#aside-frame .group-edit-input input');
  await input.fill(name);
  await input.press('Enter');
  await page.locator('#aside-frame .button-ghost--back').click();
  await expect(page.locator('#main-frame .list__item').first()).toBeVisible();
  await expect
    .poll(async () => (await boxOf(page.locator('#main-frame'))).x)
    .toBeGreaterThanOrEqual(0);
}

export type PageName = 'options' | 'view' | 'popup';

/** Open a page of the extension, and wait until it is ready to be looked at */
export const pagesOfTheExtension: Record<
  PageName,
  (page: Page, url: (path: string) => string) => Promise<void>
> = {
  async options(page, url) {
    await page.goto(url('options.html'));
    await expect(
      page.locator('form[name="formTheme"] input:checked'),
    ).toHaveCount(1, { timeout: 15000 });
  },
  async view(page, url) {
    await page.goto(url('view.html'));
    await expect(page.locator('body')).toHaveClass(/view-ready/, {
      timeout: 15000,
    });
    // A new profile has no group until one is made
    if ((await page.locator('.group').count()) === 0) {
      await page.locator('#newGroup').click();
    }
    await expect(page.locator('.group .header .name').first()).toBeVisible();
  },
  async popup(page, url) {
    await page.goto(url('popup-view/index.html'));
    await expect(page.locator('body')).not.toHaveClass(/content-loading/, {
      timeout: 15000,
    });
    if ((await page.locator('#main-frame .list__item').count()) === 0) {
      // A name with no words in it, which is the user's and not a text of the page
      await makeGroup(page, '#1');
    }
  },
};

export const PAGE_NAMES: readonly PageName[] = ['options', 'view', 'popup'];
