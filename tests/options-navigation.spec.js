import { test, expect } from '../playwright.config.js';

function getExtensionPageUrl(extensionProtocol, extensionId, pagePath) {
  return `${extensionProtocol}://${extensionId}/${pagePath}`;
}

test.describe('Options Navigation E2E', () => {
  let viewPage;

  test.beforeEach(async ({ page, extensionId, extensionProtocol }) => {
    viewPage = await page.context().newPage();
    const viewUrl = getExtensionPageUrl(
      extensionProtocol,
      extensionId,
      'view.html',
    );
    await viewPage.goto(viewUrl);
  });

  test('UI contains a Settings button that opens options', async () => {
    // Check that the settings button exists in the toolbar
    const manageButton = viewPage.locator('#settings');
    await expect(manageButton).toBeVisible();

    // In Playwright's Firefox setup, the extension is served via HTTP proxy,
    // so browser.runtime.openOptionsPage() might not open a real tab we can wait for.
    // We spy on the function instead to verify the behavior.
    await viewPage.evaluate(() => {
      window.optionsOpened = false;
      window.browser.runtime.openOptionsPage = () => {
        window.optionsOpened = true;
        return Promise.resolve();
      };
    });

    // Click the settings button
    await manageButton.click();

    // Verify the function was called
    const wasOpened = await viewPage.evaluate(() => window.optionsOpened);
    expect(wasOpened).toBe(true);
  });
});
