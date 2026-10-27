# E2E Race Conditions and StateManager Cache Removal

## The Issue: Flaky E2E Tests (Expected: 1, Received: 2)

The E2E test suite experienced non-deterministic failures in `tests/user-journeys.spec.js`, specifically within the `Journey: Create a new tab group with a new tab in it` test. The test would intermittently fail with a count mismatch error:

```
Error: expect(locator).toHaveCount(expected) failed
Locator:  locator('.group')
Expected: 1
Received: 2
```

### Root Cause

The failure was traced not to a bug in the application code, but to a subtle race condition in the test's own setup logic. The setup block conditionally created a new group if none existed:

```javascript
// Ensure we start with at least one group
if ((await page.locator('.group').count()) === 0) {
  await page.click('#newGroup');
}
const initialGroupCount = await page.locator('.group').count();
```

Because `page.click()` is an asynchronous operation that triggers a background storage update (`await save()`) and a subsequent UI render, the test did not wait for this process to complete before immediately evaluating `initialGroupCount`.

Consequently, `initialGroupCount` would frequently evaluate to `0` because the `.group` node had not yet been appended to the DOM. The test then proceeded to click the `#newGroup` button a second time as part of its actual assertions. Both clicks were successfully processed by the extension, resulting in two groups appearing in the UI.

Since `initialGroupCount` was `0`, the final assertion (`toHaveCount(initialGroupCount + 1)`) expected `1` group but received `2`, causing the test to fail. The non-deterministic nature occurred because if the background script processed the first click quickly enough, `initialGroupCount` would correctly evaluate to `1`, and the test would pass by expecting `2` groups.

### The Fix

The solution was to introduce an explicit visibility wait inside the conditional block, forcing the test runner to pause until the DOM had fully reconciled before evaluating the baseline group count:

```javascript
if ((await page.locator('.group').count()) === 0) {
  await page.click('#newGroup');
  await expect(page.locator('.group').first()).toBeVisible({ timeout: 10000 });
}
const initialGroupCount = await page.locator('.group').count();
```

---

## Architectural Change: Purging the StateManager Cache

During the investigation into state synchronization, it was discovered that the `StateManager` class in `src/js/background/StateManager.js` maintained an in-memory cache for `browser.sessions` data.

### The Problem

The caching mechanism introduced significant cross-context state leakage and race conditions. The View script and the Background script both read from and write to the same underlying `browser.sessions` storage. When the View script directly modified `browser.sessions.setWindowValue(...)`, the Background script's `StateManager` had no native way to know that the underlying storage was updated (especially in Firefox, where `browser.sessions` does not fire a global `onChanged` event). As a result, the Background script's cache would become immediately stale, leading to data inconsistencies.

### The Solution

Instead of implementing a complex message-passing invalidation system to maintain the cache across execution contexts, the caching mechanism was entirely purged from the codebase.

The rationale for this architectural decision:

1. **Redundancy**: `browser.sessions` (in Firefox) and `chrome.storage.session` (in Chromium MV3) are already highly optimized, memory-backed APIs provided natively by the browser.
2. **Performance**: Adding an application-level in-memory cache on top of an already memory-backed browser API provides negligible performance benefits.
3. **Stability**: By removing the cache, both the View and Background scripts are guaranteed to always read the absolute latest state from the browser's native memory storage, structurally eliminating a whole class of race conditions.

### Codebase Cleanup

- All cache-related logic (`this.cache`, `this.cacheTimeout`, `setCache`, `getFromCache`, `invalidateCache`, `clearCache`) was removed from `StateManager.js`.
- The `class-methods-use-this` Eslint rule was disabled for `StateManager.js`, as its internal methods no longer required instance variables but were kept as instance methods to preserve the existing singleton pattern (`export const stateManager = new StateManager();`).
- The `Caching Mechanism` describe block and all cache-related assertions were removed from the unit tests in `tests/state-manager.spec.js`.
