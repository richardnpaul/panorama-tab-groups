# Implementation Plan: Playwright E2E Testing for Chromium and Firefox

## Overview

This plan outlines the steps required to stabilize and implement end-to-end (E2E) testing for the Tab Groups Viewer extension using Playwright. The focus is to first restore Chromium compatibility (which recently broke) and then address the specific difficulties with Firefox.

## Requirements

- **Chromium:** Fix the "Extension ID for chromium was not resolved" error to restore the previously working Chromium test suite.
- **Firefox:** Address Playwright's Firefox startup hangs in containerized environments and stabilize the existing Firefox extension page proxy implementation.
- Documentation should clearly explain how to run E2E tests for both browsers, particularly detailing environmental requirements (e.g., sandboxing variables, headless mode).

## Implementation Steps

### Phase 1: Restore Chromium E2E Tests

**Problem:** The Chromium Playwright tests fail to resolve the Extension ID because the `manifest.json` specifies `"scripts"` in the background field, which Chromium rejects in MV3 (it requires `"service_worker"`). Firefox supports `"scripts"`.

1. **Update `manifest.json` for Cross-Browser MV3:**
   - Modify `src/manifest.json`'s `"background"` object to include both `"scripts": ["js/background.js"]` and `"service_worker": "js/background.js"`.
   - _Why:_ Chromium will use the service worker and ignore scripts. Firefox will prioritize scripts, preserving existing behavior.
2. **Verify Chromium Tests:**
   - Run `npx playwright test --project=chromium` and ensure all tests pass (expecting 2 passing, 1 skipped for Firefox).

### Phase 2: Tackle Firefox Difficulties

**Problem:** Playwright's Firefox launch blocks indefinitely (`EPERM` creating user namespace) in docker/dev containers without specific sandbox disables or headless environment adjustments. 3. **Disable Firefox Container Sandboxing for Tests:**

- In `playwright.config.js`, inject `MOZ_DISABLE_CONTENT_SANDBOX: '1'` and `MOZ_DISABLE_GMP_SANDBOX: '1'` into the Firefox `env` configuration. This prevents Firefox from failing to launch in standard Docker containers.

4. **Harden Firefox Headless Detection:**
   - Ensure `shouldRunHeadless(browserName)` correctly handles the lack of `DISPLAY`/`WAYLAND_DISPLAY` without blocking.
   - Fall back to using standard Xvfb if headed mode is required, or strictly enforce `headless: true`.
5. **Stabilize `playwright-webextext` RDP connections:**
   - If `launchPersistentContext` still times out, review the temporary addon installation workflow over RDP to ensure Firefox doesn't lock up during bootstrap.
6. **Verify Firefox Tests:**
   - Run `npx playwright test --project=firefox` and resolve any timeouts.

### Phase 3: Finalize & Document

7. **Document testing procedures in `TESTING.md`:**
   - Document how `manifest.json` achieves MV3 cross-compatibility.
   - Explain Docker/Dev Container specifics for Firefox.
8. **Run Linter:**
   - Ensure `npm run lint` passes without any web-ext warnings related to the updated `manifest.json`.

## Success Criteria

- [ ] `npx playwright test --project=chromium` passes successfully.
- [ ] `npx playwright test --project=firefox` executes without timing out during launch.
- [ ] Both browsers correctly resolve their Extension IDs and load the popup/options pages.
- [ ] `TESTING.md` reflects accurate commands for running these tests locally.
