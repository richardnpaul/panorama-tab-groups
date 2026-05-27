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

<!-- ### Create a new tab group

1. User navigates to the extension's Tab Groups view.
2. User clicks the "New Tab Group" button.
3. A new tab group appears in the UI with a "New Tab Group" title.

### Close tab group

1. User navigates to the extension's Tab Groups view.
2. User clicks the "Close Group" button for a group.
3. The group is removed from the UI.

### Open tab group -->
