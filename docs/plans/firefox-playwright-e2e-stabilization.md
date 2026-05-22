# Implementation Plan: Firefox Playwright E2E Stabilization

## Overview

The current Playwright setup already contains a Firefox MV3 fixture, but the saved failures show that the Firefox path is not yet reliable end to end. The implementation should stabilize local and CI Firefox launches, harden extension install and navigation readiness, and update the tests so they assert real extension UI readiness instead of assuming Chromium-like timing.

## Requirements

- Firefox Playwright runs must launch reliably in the dev container and CI without requiring a manually attached display.
- The Firefox fixture must install the MV3 extension, resolve a non-null extension UUID, and support navigation to `moz-extension://` pages for both the initial page and pages created with `context.newPage()`.
- Firefox E2E tests must use the custom fixtures consistently and avoid assertions that can pass on Chromium while masking Firefox navigation or initialization failures.
- The test suite must cover at least one Firefox-specific regression path so future changes do not reintroduce UUID or `goto()` issues.
- Project documentation must explain how Firefox E2E is expected to run locally and in the dev container.

## Affected Files

- `playwright.config.js` — stabilize Firefox launch mode, extension installation, UUID discovery, page proxying, and readiness diagnostics.
- `tests/extension.spec.js` — align imports and assertions with the custom fixture contract and actual extension DOM.
- `tests/` — add at least one new Firefox-focused regression test file or test case for multi-page extension navigation/readiness.
- `.devcontainer/devcontainer.json` — document or adjust display/headless expectations for local Firefox execution inside the container if needed.
- `TESTING.md` — replace outdated “Chromium-only automation” guidance with the intended Firefox Playwright workflow and troubleshooting steps.

## Implementation Steps

### Phase 1: Reproduce and Isolate Firefox Failure Modes

1. **Classify launch, install, and assertion failures** (`playwright.config.js`, `tests/extension.spec.js`, `test-results/`)
   - Action: Re-run the Firefox project with trace/report output and confirm the three currently visible failure classes: browser launch/display failure, null or delayed extension ID/UUID readiness, and page assertions that execute before the extension page is actually initialized.
   - Why: The current artifacts show multiple independent problems; fixing them in the wrong order will hide root causes.
   - Dependencies: None
   - Risk: Low

2. **Define an explicit local Firefox execution mode** (`playwright.config.js`, `.devcontainer/devcontainer.json`)
   - Action: Decide whether local Firefox runs should default to headless, or whether headed runs should require an explicit opt-in environment variable once a display is available. Reflect that policy in the Playwright fixture and dev container guidance.
   - Why: The saved Firefox launch failure is caused by a missing usable display while the fixture currently uses `headless: !!process.env.CI`, which is too implicit for containerized local runs.
   - Dependencies: Requires step 1
   - Risk: Medium

### Phase 2: Harden the Firefox Fixture

3. **Encapsulate Firefox extension bootstrap readiness** (`playwright.config.js`)
   - Action: Refactor the Firefox branch of the `context` and `extensionId` fixtures so addon installation, RDP disconnect, UUID polling, and failure reporting happen in one predictable flow with explicit errors when the UUID is absent.
   - Why: Chromium can tolerate late extension ID discovery better than Firefox; `moz-extension://null/...` is a hard failure and should be blocked earlier.
   - Dependencies: Requires step 2
   - Risk: Medium

4. **Stabilize page proxy behavior for both initial and new pages** (`playwright.config.js`)
   - Action: Review the existing `createFirefoxPageProxy` and `context.newPage` wrapping so only one proxy is ever applied per real page, and ensure the patched `goto()` waits for a usable document state before returning.
   - Why: The project already documents Firefox-specific `NS_ERROR_NOT_AVAILABLE` risks from double-wrapping or racing `goto()` calls, and the options test depends on `context.newPage()`.
   - Dependencies: Requires step 3
   - Risk: High

5. **Add fixture-level diagnostics that fail fast** (`playwright.config.js`)
   - Action: Add targeted logging or guard assertions for extension protocol, UUID resolution, and page URL/document readiness so failures identify whether the problem is launch, install, navigation, or app initialization.
   - Why: Current failures collapse into empty-body assertions, which makes Firefox debugging slower than necessary.
   - Dependencies: Requires step 4
   - Risk: Low

### Phase 3: Align Tests with Real Extension Behavior

6. **Normalize test entrypoints and fixture usage** (`tests/extension.spec.js`)
   - Action: Update the test file so it uses the custom exported fixtures in the supported way, verifies `extensionId` before navigation, and navigates only to extension pages that actually exist in this repository.
   - Why: Firefox tests are more sensitive to mismatches between the fixture contract and the test harness, especially when importing custom fixtures from `playwright.config.js`.
   - Dependencies: Requires step 5
   - Risk: Medium

7. **Replace brittle text assertions with readiness-driven selectors** (`tests/extension.spec.js`)
   - Action: Change the popup and options tests to wait on stable selectors or page-specific initialization markers instead of immediately asserting broad body text.
   - Why: The current options failure (`body` text is empty) indicates the test is asserting too early or at the wrong readiness boundary.
   - Dependencies: Requires step 6
   - Risk: Medium

8. **Add a Firefox regression case for secondary-page navigation** (`tests/`)
   - Action: Add at least one new E2E case that opens a second extension page, such as `options.html` after the initial blank page or after visiting the popup, and validates that the document initializes correctly.
   - Why: This specifically protects the high-risk Firefox path that differs from Chromium and is currently failing.
   - Dependencies: Requires step 7
   - Risk: Medium

### Phase 4: Document and Verify the Supported Workflow

9. **Update Firefox Playwright documentation** (`TESTING.md`)
   - Action: Rewrite the automated testing section to state that Firefox Playwright is supported, document the required command(s), describe the headless/headed behavior, and include troubleshooting for display errors, null UUIDs, and stalled `moz-extension://` navigation.
   - Why: The existing documentation still says Chromium is used for automation, which no longer matches the repository direction or fixture design.
   - Dependencies: Requires step 8
   - Risk: Low

10. **Validate both projects and preserve lint cleanliness** (`playwright.config.js`, `tests/`, `TESTING.md`)

- Action: Run `npm run format`, `npm run lint`, `npx playwright test --project=firefox`, and `npx playwright test --project=chromium` to confirm Firefox fixes do not regress Chromium.
- Why: The Firefox fixture and shared tests are cross-project infrastructure; validation must confirm both paths remain green.
- Dependencies: Requires step 9
- Risk: Medium

## WebExtension API Notes

- No manifest permission changes are expected for this work; the effort is focused on Playwright orchestration around existing extension pages.
- Firefox navigation uses `moz-extension://<uuid>/...`, and the UUID must be derived from the installed temporary addon whose ID must match `browser_specific_settings.gecko.id` in `src/manifest.json`.
- The current Firefox bootstrap depends on MV3 service worker support plus RDP temporary addon installation; the plan should preserve the existing workaround of disconnecting the RDP client after install so Juggler navigation events can resume.
- If tests begin asserting native tab group behavior later, note that Firefox and Chromium differ materially on `tabGroups` and `tabs.hide/show`; those should remain out of scope for the initial stabilization pass.

## Testing Strategy

- E2E tests: Update `tests/extension.spec.js` and add one Firefox-focused regression case under `tests/` that covers extension UUID readiness and second-page navigation.
- Manual verification: Run `npx playwright test --project=firefox` inside the dev container, then rerun with the local headed mode the project chooses to support.
- Cross-browser verification: Run `npx playwright test --project=chromium` after the Firefox changes because `playwright.config.js` is shared.
- Failure diagnostics: Inspect the Playwright HTML report and trace for any remaining empty-body or `moz-extension://null/...` failures.

## Risks & Mitigations

- **Risk**: Firefox launch behavior differs between CI and the dev container due to display availability. — Mitigation: make headless/headed behavior explicit and document the supported local path.
- **Risk**: The current proxy relies on Playwright internals that may be fragile across versions. — Mitigation: isolate the workaround behind well-named helpers and add a regression test that exercises it directly.
- **Risk**: Tests may still pass on Chromium while masking Firefox timing bugs. — Mitigation: add Firefox-specific readiness assertions and run the Firefox project separately during validation.
- **Risk**: Extension UUID polling can remain flaky if addon installation is not fully complete. — Mitigation: fail fast with actionable logs instead of allowing `null` IDs to reach test navigation.

## Success Criteria

- [ ] `npx playwright test --project=firefox` runs reliably in the supported local/container workflow.
- [ ] Firefox tests never navigate to `moz-extension://null/...` URLs.
- [ ] Popup and options page tests assert stable, page-specific readiness signals instead of empty-body text checks.
- [ ] At least one regression test covers Firefox secondary-page extension navigation.
- [ ] `npm run lint` passes after the Playwright and documentation updates.
