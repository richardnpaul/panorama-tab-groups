import { test, expect } from '../playwright.config.js';

function getExtensionPageUrl(extensionProtocol, extensionId, pagePath) {
  if (!extensionId) {
    throw new Error(
      `Extension ID was not resolved before navigating to ${pagePath}`,
    );
  }

  return `${extensionProtocol}://${extensionId}/${pagePath}`;
}

async function gotoExtensionPage(
  page,
  extensionProtocol,
  extensionId,
  pagePath,
) {
  const targetUrl = getExtensionPageUrl(
    extensionProtocol,
    extensionId,
    pagePath,
  );

  await page.goto(targetUrl, { timeout: 15000 });

  // Poll client-side page.url() to avoid server-side toHaveURL hang/failures in Firefox
  const startTime = Date.now();
  // eslint-disable-next-line no-await-in-loop
  while (page.url() !== targetUrl && Date.now() - startTime < 5000) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(50);
  }
  expect(page.url()).toBe(targetUrl);

  return targetUrl;
}

async function waitForPopupPageReady(page) {
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

async function waitForOptionsPageReady(page) {
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

test('options page loads', async ({
  context,
  extensionId,
  extensionProtocol,
}) => {
  const page = await context.newPage();

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
