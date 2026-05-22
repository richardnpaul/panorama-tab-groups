# Implementation Plan: Fix web-ext Lint Warnings

## Overview

Three `web-ext lint` warnings are emitted when running `npm run test` (`npm run lint:webext`).
This plan resolves all three: a missing manifest field required by Firefox/AMO, an unsupported
manifest key that Firefox silently ignores, and one or more unsafe `innerHTML` assignments that
could allow DOM XSS in privileged extension pages.

## Requirements

- Remove all three warnings from `web-ext lint` output with zero regressions.
- Maintain Firefox MV3 (primary) compatibility fully.
- Document any trade-off with Chromium MV3 experimental support where applicable.
- Follow the `textContent` / DOM-construction approach mandated by `#skill:webext-security` (C2).
- All changes must pass `npm run lint` (ESLint + Prettier + web-ext).

## Affected Files

- `src/manifest.json` — add `data_collection_permissions`; remove `service_worker` key
- `src/js/migration-status.js` — remove `innerHTML = ''` clear (line 28) and template-literal
  `innerHTML` assignment (lines 50–54)
- `src/popup-view/js/Frame.js` — replace `innerHTML = ''` clear (line 5) with `textContent = ''`
- `src/js/options/statistics.js` — replace two `innerHTML = ''` clears (lines 27, 32) with
  `replaceChildren()`
- `src/js/view/groupNodes.js` — replace two `innerHTML = ''` clears (lines 115, 556) with
  `textContent = ''`
- `src/js/view/tabNodes.js` — replace `innerHTML = ''` clear (line 103) with `textContent = ''`

---

## Implementation Steps

### Phase 1: Manifest Fixes

#### 1.1 Add `data_collection_permissions` (`src/manifest.json`)

- **Action**: Add a `data_collection_permissions` object to `browser_specific_settings.gecko`.
  This property is now required for all new Firefox extensions submitted to AMO. Since the
  extension does not collect any user data, both sub-arrays are empty.

  Replace:

  ```json
  "browser_specific_settings": {
    "gecko": {
      "id": "tab-groups-viewer@example.com"
    }
  }
  ```

  With:

  ```json
  "browser_specific_settings": {
    "gecko": {
      "id": "tab-groups-viewer@example.com",
      "data_collection_permissions": {
        "required": [],
        "optional": []
      }
    }
  }
  ```

- **Why**: web-ext 9.x enforces this field for AMO submission; its absence triggers
  `MISSING_DATA_COLLECTION_PERMISSIONS`.
- **Dependencies**: None
- **Risk**: Low — additive-only manifest change; no runtime behaviour altered.

#### 1.2 Remove `service_worker` key (`src/manifest.json`)

- **Action**: Remove the `"service_worker": "js/background.js"` line from the `background`
  object. The remaining `"scripts"` array is the correct Firefox MV3 mechanism.

  Replace:

  ```json
  "background": {
    "scripts": ["js/background.js"],
    "service_worker": "js/background.js",
    "type": "module"
  }
  ```

  With:

  ```json
  "background": {
    "scripts": ["js/background.js"],
    "type": "module"
  }
  ```

- **Why**: Firefox MV3 uses `background.scripts` (event-page model) and silently ignores
  `background.service_worker`, but web-ext warns with `BACKGROUND_SERVICE_WORKER_IGNORED`.
  Removing the unsupported key silences the warning.
- **Chromium trade-off**: Chromium MV3 **requires** `service_worker` and ignores `scripts`.
  Removing the key means the extension will not load as a Chromium service worker. Since
  Chromium support is explicitly experimental, this is an acceptable trade-off. If full Chromium
  support is restored in future, a browser-specific build step (e.g. per-browser `manifest.json`
  overrides) should be introduced rather than reverting this fix.
- **Dependencies**: None
- **Risk**: Low for Firefox (primary target). Medium for Chromium (experimental, stops loading as
  a service worker).

---

### Phase 2: Replace Unsafe `innerHTML` Assignments

All eight `innerHTML` occurrences found in `src/` are addressed below. Six are the `= ''` clear
pattern (web-ext flags any `innerHTML` assignment); one is a template-literal assignment that is
an **actual DOM XSS risk** (`migration-status.js:50`).

> **Security note (OWASP A03)**: `src/js/migration-status.js` line 50 interpolates
> `group.id`, `group.name`, and `group.nativeGroupId` directly into an HTML string. Although
> these values come from `browser.sessions` (local storage), they are ultimately derived from tab
> group data which could be influenced by browsing activity. Using raw `innerHTML` with any
> dynamic content in a privileged extension page violates the DOM XSS rule (C2 in
> `#skill:webext-security`).

#### 2.1 `src/js/migration-status.js` — lines 28 and 50–54

**Line 28** — clear pattern:

Replace:

```javascript
container.innerHTML = '';
```

With:

```javascript
container.textContent = '';
```

**Lines 50–54** — template-literal (CRITICAL fix):

Replace:

```javascript
groupDiv.innerHTML = `
        <strong>Group ${group.id}:</strong> ${group.name}<br>
        <small>Status: ${status}</small>
      `;
```

With:

```javascript
const strong = document.createElement('strong');
strong.textContent = `Group ${group.id}:`;
groupDiv.appendChild(strong);
groupDiv.appendChild(document.createTextNode(` ${group.name}`));
groupDiv.appendChild(document.createElement('br'));
const small = document.createElement('small');
small.textContent = `Status: ${status}`;
groupDiv.appendChild(small);
```

- **Why**: Eliminates DOM XSS vector by constructing the DOM safely. `textContent` assigns
  are always HTML-escaped by the browser.
- **Dependencies**: None
- **Risk**: Low — `migration-status.js` is a diagnostic/debug page, not a user-facing feature.

#### 2.2 `src/popup-view/js/Frame.js` — line 5

Replace:

```javascript
contentNode.innerHTML = '';
```

With:

```javascript
contentNode.textContent = '';
```

- **Why**: `textContent = ''` removes all child nodes identically to `innerHTML = ''` for a
  clearing operation, but does not trigger the lint warning.
- **Dependencies**: None
- **Risk**: Low — purely a clear operation; no HTML content involved.

#### 2.3 `src/js/options/statistics.js` — lines 27 and 32

The existing pattern clears with `innerHTML = ''` then immediately appends a `createTextNode`.
Replace both clear + append pairs with a single `replaceChildren()` call for clarity:

Replace lines 27–30:

```javascript
document.getElementById('thumbnailCacheSize').innerHTML = '';
document
  .getElementById('thumbnailCacheSize')
  .appendChild(document.createTextNode(formatByteSize(totalSize)));
```

With:

```javascript
document
  .getElementById('thumbnailCacheSize')
  .replaceChildren(document.createTextNode(formatByteSize(totalSize)));
```

Replace lines 32–40:

```javascript
document.getElementById('numberOfTabs').innerHTML = '';
document
  .getElementById('numberOfTabs')
  .appendChild(
    document.createTextNode(
      `${tabs.length} (${browser.i18n.getMessage(
        'optionsStatisticsNumberOfTabsActive',
      )} ${numActiveTabs})`,
    ),
  );
```

With:

```javascript
document
  .getElementById('numberOfTabs')
  .replaceChildren(
    document.createTextNode(
      `${tabs.length} (${browser.i18n.getMessage(
        'optionsStatisticsNumberOfTabsActive',
      )} ${numActiveTabs})`,
    ),
  );
```

- **Why**: `replaceChildren()` atomically clears existing content and sets new children,
  making the clear + append pattern unnecessary. Supported in Firefox 78+ and all modern browsers.
- **Dependencies**: None
- **Risk**: Low — `replaceChildren()` is widely supported; behaviour is identical.

#### 2.4 `src/js/view/groupNodes.js` — lines 115 and 556

**Line 115**:

Replace:

```javascript
node.tabCount.innerHTML = '';
node.tabCount.appendChild(document.createTextNode(childNodes.length - 1));
```

With:

```javascript
node.tabCount.replaceChildren(document.createTextNode(childNodes.length - 1));
```

**Line 556**:

Replace:

```javascript
name.innerHTML = '';
name.appendChild(document.createTextNode(input.value));
```

With:

```javascript
name.replaceChildren(document.createTextNode(input.value));
```

- **Why**: Same clear-and-set consolidation as step 2.3.
- **Dependencies**: None
- **Risk**: Low — hot render path; `replaceChildren()` is synchronous and equally performant.

#### 2.5 `src/js/view/tabNodes.js` — line 103

Replace:

```javascript
node.name.innerHTML = '';
node.name.appendChild(document.createTextNode(tab.title));
```

With:

```javascript
node.name.replaceChildren(document.createTextNode(tab.title));
```

- **Why**: Eliminates the `innerHTML` assignment; `tab.title` is user-controlled content
  (page titles), making the safe pattern especially important here (OWASP A03).
- **Dependencies**: None
- **Risk**: Low.

---

## WebExtension API Notes

- No new `browser.*` API calls are introduced by this plan.
- `data_collection_permissions` is a static manifest declaration; it does not affect runtime API
  access.
- Removing `service_worker` from the manifest means Chromium will not load the background script
  via the MV3 service-worker mechanism. Firefox is unaffected.
- `replaceChildren()` is a standard DOM Level 4 API — available in Firefox 78+ (well within the
  MV3 baseline) and Chrome 86+.

---

## Testing Strategy

### Automated: `npm run lint` (CI gate)

After each phase, run:

```bash
npm run lint
```

Expected: zero ESLint errors, zero Prettier violations, zero web-ext warnings.

### Manual Verification — Phase 1 (Manifest)

1. Run `npx web-ext lint -s src` and confirm:
   - `MISSING_DATA_COLLECTION_PERMISSIONS` warning is absent.
   - `BACKGROUND_SERVICE_WORKER_IGNORED` warning is absent.
2. Load the unpacked extension in Firefox (`about:debugging`) and confirm the background script
   initialises normally (check browser console for any errors from `background.js`).

### Manual Verification — Phase 2 (innerHTML)

| File                  | Verification step                                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `migration-status.js` | Open `migration-status.html` in Firefox with the extension loaded; confirm group list renders correctly with correct text content |
| `Frame.js`            | Open `popup-view/index.html`; switch between groups and confirm popup content updates without blank rendering                     |
| `statistics.js`       | Open `options.html` → Statistics tab; confirm thumbnail cache size and tab count display correctly                                |
| `groupNodes.js`       | Open `view.html`; rename a group and confirm the heading updates; confirm tab-count badges update                                 |
| `tabNodes.js`         | Open `view.html`; navigate to a page with a long title and confirm tab label updates                                              |

### E2E Regression

Run the existing Playwright suite to confirm no regressions:

```bash
npm run test:e2e
```

No new E2E test cases are required for this plan because:

- The manifest changes are not observable at the JavaScript level (they affect AMO submission
  and Firefox addon loading, not UI behaviour).
- The `innerHTML` → `textContent`/`replaceChildren` replacements are semantically equivalent
  for the plain-text content all call sites use; the existing E2E tests that exercise the popup,
  view, and options pages act as sufficient regression coverage.

---

## Risks & Mitigations

- **Risk**: Removing `service_worker` breaks Chromium MV3 background loading.
  **Mitigation**: Chromium support is explicitly experimental. Document the removal in the commit
  message. If Chromium support must be restored, introduce a build step to emit a
  Chromium-specific `manifest.json` that re-adds `service_worker`.

- **Risk**: `replaceChildren()` used on an element that still has live event listeners attached
  to children.
  **Mitigation**: All three call sites (`tabCount`, `name` in groupNodes, `name` in tabNodes)
  hold text-only child nodes with no attached listeners. The replacement is safe.

- **Risk**: `data_collection_permissions` format changes in a future web-ext version.
  **Mitigation**: The empty `required`/`optional` arrays are the minimal valid form. Monitor
  `web-ext` changelog on upgrades.

---

## Success Criteria

- [ ] `npx web-ext lint -s src` produces **zero** warnings (MISSING_DATA_COLLECTION_PERMISSIONS,
      BACKGROUND_SERVICE_WORKER_IGNORED, UNSAFE_VAR_ASSIGNMENT all absent).
- [ ] `npm run lint` passes with zero errors.
- [ ] Firefox loads the extension and background script initialises without console errors.
- [ ] All existing Playwright E2E tests pass (`npm run test:e2e`).
- [ ] `migration-status.html` renders group data correctly without using `innerHTML`.
- [ ] Popup, view, and options pages render and interact normally.
