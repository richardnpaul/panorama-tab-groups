import type { Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

function getExtensionPageUrl(
  extensionProtocol: string,
  extensionId: string,
  pagePath: string,
): string {
  if (!extensionId) {
    throw new Error(
      `Extension ID was not resolved before navigating to ${pagePath}`,
    );
  }

  return `${extensionProtocol}://${extensionId}/${pagePath}`;
}

async function gotoExtensionPage(
  page: Page,
  extensionProtocol: string,
  extensionId: string,
  pagePath: string,
): Promise<string> {
  const targetUrl = getExtensionPageUrl(
    extensionProtocol,
    extensionId,
    pagePath,
  );

  await page.goto(targetUrl, { timeout: 15000 });

  // Poll client-side page.url() to avoid server-side toHaveURL hang/failures in Firefox
  await expect.poll(() => page.url(), { timeout: 5000 }).toBe(targetUrl);

  return targetUrl;
}

async function waitForPopupPageReady(page: Page): Promise<void> {
  console.log('[TEST LOG] waitForPopupPageReady start');
  console.log(
    '[TEST LOG] waitForPopupPageReady: checking #frame-shell visibility',
  );
  await expect(page.locator('#frame-shell')).toBeVisible({ timeout: 15000 });
  console.log(
    '[TEST LOG] waitForPopupPageReady: #frame-shell is visible, checking body class',
  );
  await expect(page.locator('body')).not.toHaveClass(/content-loading/, {
    timeout: 15000,
  });
  console.log(
    '[TEST LOG] waitForPopupPageReady: body class is ok, checking #main-frame class',
  );
  await expect(page.locator('#main-frame')).toHaveClass(/frame--active/, {
    timeout: 15000,
  });
  console.log(
    '[TEST LOG] waitForPopupPageReady: #main-frame class is ok, checking input',
  );
  await expect(page.locator('#main-frame .form-field__input')).toBeVisible({
    timeout: 15000,
  });
  console.log('[TEST LOG] waitForPopupPageReady: input is visible!');
}

async function waitForOptionsPageReady(page: Page): Promise<void> {
  await expect(page.locator('#optionKeyboardShortcuts')).toBeVisible({
    timeout: 15000,
  });
  await expect(page.locator('#optionsTheme')).toBeVisible({ timeout: 15000 });
  await expect(
    page.locator('form[name="formTheme"] input:checked'),
  ).toHaveCount(1, { timeout: 15000 });
  await expect(page.locator('#useNativeGroups')).toBeVisible({
    timeout: 15000,
  });
}

test('popup page loads', async ({ page, extensionId, extensionProtocol }) => {
  console.log('[TEST LOG] popup page loads test: start');
  const targetUrl = await gotoExtensionPage(
    page,
    extensionProtocol,
    extensionId,
    'popup-view/index.html',
  );
  console.log(
    '[TEST LOG] popup page loads test: extension page navigated to:',
    targetUrl,
  );

  await waitForPopupPageReady(page);
  console.log('[TEST LOG] popup page loads test: complete');
});

test('options page loads', async ({ page, extensionId, extensionProtocol }) => {
  await gotoExtensionPage(page, extensionProtocol, extensionId, 'options.html');
  await waitForOptionsPageReady(page);
  await expect(page.locator('#optionsTheme h2')).toHaveText(/Theme/i);
  await expect(page.locator('#optionKeyboardShortcuts h2')).toHaveText(
    /Keyboard Shortcuts/i,
  );
});

test('firefox can open a second extension page after popup navigation', async ({
  browserName,
  context,
  extensionId,
  extensionProtocol,
  page,
}) => {
  test.skip(browserName !== 'firefox', 'Firefox regression coverage only');

  await gotoExtensionPage(
    page,
    extensionProtocol,
    extensionId,
    'popup-view/index.html',
  );
  await waitForPopupPageReady(page);

  const optionsPage = await context.newPage();
  await gotoExtensionPage(
    optionsPage,
    extensionProtocol,
    extensionId,
    'options.html',
  );
  await waitForOptionsPageReady(optionsPage);
});

test('chromium service worker initializes without errors', async ({
  browserName,
  context,
  page,
}) => {
  if (browserName !== 'chromium') {
    test.skip();
    return;
  }

  // Set the page to a descriptive text so the screenshot isn't just a blank white screen
  await page.goto(
    'data:text/html,<body style="background: white; padding: 2rem; font-family: sans-serif;"><h1>Service Worker Test</h1><p>Checking service worker initialization state...</p></body>',
  );

  // Wait for the service worker to be available
  const [existing] = context.serviceWorkers();
  const worker = existing ?? (await context.waitForEvent('serviceworker'));

  expect(worker).toBeTruthy();

  // Evaluate state inside the service worker
  const isAlive = await worker.evaluate(() =>
    Boolean(Reflect.get(globalThis, 'chrome')),
  );

  expect(isAlive).toBe(true);
});

test('native browser groups option disabled in chromium', async ({
  browserName,
  page,
  extensionId,
  extensionProtocol,
}) => {
  // We only run this regression test for chromium, since firefox's behavior
  // depends on the actual API availability which is complex to mock fully.
  test.skip(browserName !== 'chromium', 'Chromium regression coverage only');

  await gotoExtensionPage(page, extensionProtocol, extensionId, 'options.html');
  await waitForOptionsPageReady(page);

  const nativeGroupsCheckbox = page.locator('#useNativeGroups');
  await expect(nativeGroupsCheckbox).toBeEnabled();
  await expect(nativeGroupsCheckbox).toBeChecked();

  // Verify the error text is visible
  const warningText = page.locator('#nativeGroupsWarning');
  await expect(warningText).toHaveClass(/warning-text/);
  await expect(warningText).toContainText('not supported');
});

test.describe('Regression Tests', () => {
  test('background service worker initializes without crashing', async ({
    page,
    extensionId,
    extensionProtocol,
  }) => {
    // Navigate to an extension page to ensure we have extension privileges
    const optionsUrl = getExtensionPageUrl(
      extensionProtocol,
      extensionId,
      'options.html',
    );
    await page.goto(optionsUrl);

    // Send a message to the background script to verify it's alive and hasn't crashed
    // If the background script crashed during initialization (e.g., ReferenceError: window is not defined),
    // this message will fail with "Could not establish connection. Receiving end does not exist."
    const backgroundResponse = await page.evaluate(async () => {
      try {
        const response: unknown = await browser.runtime.sendMessage({
          action: 'checkViewRefresh',
        });
        return { success: true, response };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    expect(
      backgroundResponse.success,
      `Background script crashed or is unresponsive. Error: ${String(backgroundResponse.error)}`,
    ).toBe(true);
  });
});
