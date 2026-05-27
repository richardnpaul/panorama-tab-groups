# Testing the Modernized Tab Groups Tab Groups Extension

## Prerequisites

1. **Firefox Developer Edition** - Perfect for extension testing! (You have this)
2. **Node.js and npm** - Already installed (you have the dependencies)

## Method 1: Using web-ext with Firefox Developer Edition (Recommended)

### Option A: Automatic Detection

```bash
cd /home/richard/dev/third-party-code/Tab Groups-tab-groups
npm run start
```

### Option B: Specify Firefox Developer Edition Explicitly

```bash
# If you have multiple Firefox versions, specify Developer Edition
npm run start -- --firefox=/usr/bin/firefox
# or try:
npm run start -- --firefox=firefoxdeveloperedition
```

### Option C: With Developer Tools and Verbose Output

```bash
npm run start -- --devtools --verbose
```

## Method 2: Manual Installation (Good for persistent testing)

### Step 1: Build the extension

```bash
npm run build
```

This creates a `.zip` file in `web-ext-artifacts/` directory.

### Step 2: Install in Firefox Nightly

1. Open Firefox Nightly
2. Navigate to `about:debugging`
3. Click "This Firefox"
4. Click "Load Temporary Add-on..."
5. Navigate to the `src/` folder and select `manifest.json`

## Method 3: Developer Mode (Best for debugging)

### Step 1: Enable Developer Mode

1. Open Firefox Nightly
2. Go to `about:config`
3. Set `extensions.experiments.enabled` to `true`
4. Set `xpinstall.signatures.required` to `false` (for unsigned extensions)

### Step 2: Load Extension

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on..."
3. Select `src/manifest.json`

## What to Test

### Basic Functionality

1. **Extension Icon**: Should appear in toolbar
2. **Popup View**: Click the extension icon to see popup
3. **Tab Groups**: Create and manage tab groups
4. **Keyboard Shortcuts**:
   - `Ctrl+Shift+F`: Toggle Tab Groups View
   - `Alt+W`: Next group
   - `Alt+Shift+W`: Previous group

### Tab Groups View

1. Click extension icon or use `Ctrl+Shift+F`
2. Should open Tab Groups view showing all tab groups
3. Test drag and drop functionality
4. Test creating new groups
5. Test moving tabs between groups

### Options Page

1. Go to `about:addons`
2. Find "Tab Groups Tab Groups"
3. Click "Options"
4. Test all settings:
   - View mode (Freeform vs Popup)
   - Theme (Light vs Dark)
   - Toolbar position
   - Keyboard shortcuts
   - Backup/restore functionality

### Modern Features to Verify

1. **Manifest V3 Compliance**: Extension should load without warnings
2. **Message Passing**: Options changes should work properly
3. **Permissions**: Should only request necessary permissions
4. **API Compatibility**: All tab operations should work

## Debugging

### Console Logs

1. Open Developer Tools (`F12`)
2. Go to Console tab
3. Look for any errors or warnings

### Extension Debugging

1. Go to `about:debugging#/runtime/this-firefox`
2. Find your extension
3. Click "Inspect" to open extension devtools

### Background Script Debugging

- The background script logs will appear in the extension's console
- Use `console.log()` statements in `js/background.js` for debugging

## Common Issues and Solutions

### Extension Won't Load

- Check `about:debugging` for error messages
- Verify `manifest.json` syntax with: `npm run lint:webext`
- Check browser console for errors

### Permissions Warnings

- Modern Firefox should not show permission warnings
- If you see warnings, check the manifest permissions

### Functionality Not Working

- Check if browser.action API is supported (Firefox 109+)
- Verify all message passing is working
- Check for JavaScript errors in console

## Testing Different Firefox Versions

### Minimum Version Check

The extension requires Firefox 109+ for full Manifest V3 support.

### Version-Specific Testing

```bash
# Test with different Firefox versions
web-ext run -s src --firefox=/path/to/firefox-esr
web-ext run -s src --firefox=/path/to/firefox-beta
web-ext run -s src --firefox=/path/to/firefox-nightly
```

## Performance Testing

### Memory Usage

1. Open `about:memory`
2. Click "Measure"
3. Look for extension-related memory usage

### Startup Time

- Note how quickly the extension loads
- Check for any startup delays

## Automated Testing

### Automated Testing (Playwright)

We use Playwright for end-to-end automated testing in both Chromium and Firefox. Firefox is the primary browser for extension behavior, and the repository includes a custom fixture in `playwright.config.js` to handle temporary addon install, UUID discovery, and `moz-extension://` navigation.

```bash
# Run all end-to-end tests
npm run test:e2e

# Run only Firefox extension tests
npx playwright test --project=firefox

# Run only Chromium extension tests
npx playwright test --project=chromium
```

**Local execution mode:**

- Local Playwright runs default to headless mode.
- To opt into a headed Firefox run in the dev container, start the desktop session and run `PLAYWRIGHT_FIREFOX_HEADED=1 npx playwright test --project=firefox`.
- `PLAYWRIGHT_HEADED=1` enables headed mode for all projects.

**What is tested:**

- **Extension bootstrap**: Verifies the extension loads and resolves a non-null runtime ID/UUID before navigation.
- **Popup View**: Verifies the popup opens and reaches its ready UI state.
- **Options Page**: Verifies the options page initializes its settings UI.
- **Firefox multi-page navigation**: Verifies Firefox can open a second extension page without regressing the custom `moz-extension://` proxy path.

**Chromium compatibility notes:**

- **`src/manifest.json`**: Uses `background.service_worker` for MV3 compatibility.
- **Polyfill**: `src/js/polyfill.js` maps `browser` to `chrome` and mocks the Firefox-specific `sessions` API with storage-backed fallbacks when needed.

**Firefox troubleshooting:**

- **`Executable doesn't exist ... ms-playwright/firefox-*`**: Run `npx playwright install firefox chromium`.
- **`Extension ID for firefox was not resolved`**: Check the temporary addon install logs and confirm `browser_specific_settings.gecko.id` in `src/manifest.json` still matches the test fixture.
- **`moz-extension://null/...` navigation**: This indicates UUID resolution failed before page navigation; inspect the Playwright report and `prefs.js` UUID registration.
- **Headed launch fails due to `DISPLAY`/`WAYLAND_DISPLAY`**: Use the dev container desktop or rerun without `PLAYWRIGHT_FIREFOX_HEADED=1`.

### Lint Everything

```bash
npm run lint
```

### Build for Distribution

```bash
npm run build
```

## Success Criteria

✅ Extension loads without errors or warnings
✅ All original functionality works
✅ No permission warnings in Firefox
✅ Options page loads and settings persist
✅ Keyboard shortcuts work
✅ Tab capture (thumbnails) work
✅ Backup/restore functionality works
✅ Dark/light themes work properly (classList bug fixed)
✅ Message passing between components works

## Dark Mode Fix Applied

**Issue**: Dark theme wasn't applying due to `classList.forEach()` bug
**Fix**: Replaced `forEach` with `Array.from().filter()` approach
**Test**: Go to Options → Theme → Dark to verify dark mode works

## Auto Theme Feature Added

**New Feature**: Added "Follow System" theme option
**Behavior**: Automatically switches between light/dark based on browser/OS preference
**Default**: New installations default to "Follow System"
**Test**:

1. Go to Options → Theme → Follow System
2. Change your OS dark mode setting
3. Extension should automatically switch themes

## Theme Persistence Fix

**Issue**: Selected theme settings were not being remembered
**Fix**: Added debugging and improved storage handling
**Test**: Change theme, reload extension, verify setting persists

## Theme Styling Rollback

**Issue**: Complex styling was causing button overlaps and unwanted outlines
**Fix**: Rolled back to simple `input-radio-image` class with minimal custom styling
**Result**: Clean theme buttons without overlapping or visual artifacts

## Next Steps After Testing

1. **Report Issues**: Document any bugs found
2. **Performance**: Note any performance improvements/regressions
3. **User Experience**: Compare with old version
4. **Security**: Verify reduced permission requirements
5. **Compatibility**: Test across different Firefox versions

## Files to Monitor During Testing

- Browser console for JavaScript errors
- Extension console for background script issues
- Network tab for any unexpected requests
- Storage tab for local/sync storage operations
