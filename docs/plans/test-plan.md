# Test Plan

## User Journeys

### Basic navigation to Tab Groups view

- Test: `Journey: Basic navigation to Tab Groups view`

1. User clicks on the extensions icon.
2. "Tab Groups View" is displayed in the menu.
3. User clicks on "Tab Groups View" in the menu.
4. The extension's Tab Groups view opens.
5. New tab is opened with url `../view.html`.
6. The new tab is focused.

### Basic add tab to group works

- Test: `Journey: Basic add tab to group works`

1. User navigates to the extension's Tab Groups view.
2. User clicks the "Add Tab" button.
   - The new tab is focused.
   - A new tab is added to the group and the native tab group is visible
   - A new tab is added to the group with `stateManager.newTab()`.
   - The Tab Groups view tab is no longer in the tabs bar
3. User navigates to the extensions Tab Groups view again
   - Only two tabs are in the Grp0 group

### Create a new tab group with a new tab in it

- Test: `Journey: Create a new tab group with a new tab in it`

1. User navigates to the extension's Tab Groups view.
2. User sees that there is one tab group containing one tab.
3. User clicks the "New Tab Group" button.
   - A new tab group appears in the UI with a "New Tab Group" title.
4. User clicks the "Add Tab" (new tab) button inside the newly created tab group.
   - A new browser tab is created and focused.
   - A new native browser tab group is created and visible in the browser's tab bar.
   - The Tab Groups view tab is automatically closed (no longer in the tabs bar).
5. User navigates back to the extension's Tab Groups view (e.g., by clicking the extension icon).
   - The new tab group (Grp1) contains one tab.
   - The original tab group (Grp0) still contains one tab.

### Test relabelling a tab group

- Test: `Journey: Test relabelling a tab group`

1. User navigates to the extension's Tab Groups view.
2. User double clicks the group title (Grp0).
3. User types "New Label" in the title input.
4. User presses Enter.
5. The label for the group in the extension UI is changed to "New Label".
   - The corresponding native browser tab group's title is also updated to "New Label" (if applicable).
6. User closes and re-opens the Tab Groups view.
   - The label for the group persists and is still "New Label".

### Close (delete) tab group

- Test: `Journey: Close (delete) tab group`

1. User navigates to the extension's Tab Groups view.
2. User creates a new tab group.
3. User creates a new tab in the new group.
4. User clicks the "Close Group" button for the _newly created_ group.
   - (If a confirmation dialog appears, the user accepts it).
   - The group is permanently removed from the extension's UI.
   - The tabs belonging to the group are closed in the browser.
   - The native browser tab group is closed/removed.
   - The original tab group remains unaffected in the UI.

### Open tab group
