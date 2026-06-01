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

### Open tab group

(Pending definition)

### Multi-window tab group isolation

- Test: `Journey: Multi-window tab group isolation`

1. User opens the extension's Tab Groups view in Window A.
2. User creates a new tab group named "Group A" in Window A.
3. User opens a new browser window (Window B) and navigates to the Tab Groups view.
4. Window B does not show "Group A". It displays its own isolated state (default group).
5. User creates a new tab group "Group B" in Window B.
6. User verifies that Window A remains unaffected and still only shows "Group A".

### Session restore restores tab groups into correct window

- Test: `Journey: Session restore restores tab groups into correct window`

1. User has Window A with "Group A" and a new tab inside it.
2. User opens Window B with "Group B" and a new tab inside it.
3. User closes Window B.
4. User restores the recently closed Window B.
5. User navigates to the Tab Groups view in the restored Window B.
6. User observes that "Group B" is successfully restored with its corresponding tabs.

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

### Multi-window tab group isolation

1. User opens the extension's Tab Groups view in Window A.
2. User creates a new tab group named "Group A" in Window A.
3. User opens a new browser window (Window B) and navigates to the Tab Groups view.
4. Window B does not show "Group A". It displays its own isolated state (default group).
5. User creates a new tab group "Group B" in Window B.
6. User verifies that Window A remains unaffected and still only shows "Group A".

### Session restore restores tab groups into correct window

1. User has Window A with "Group A" and a new tab inside it.
2. User opens Window B with "Group B" and a new tab inside it.
3. User closes Window B.
4. User restores the recently closed Window B.
5. User verifies that the restored Window B correctly shows "Group B" and its tab, fully intact and isolated from Window A.

### Move tab between existing groups

1. User opens the Tab Groups view.
2. User creates Group A and adds 2 tabs to it.
3. User creates Group B and adds 1 tab to it.
4. User drags one tab from Group A and drops it into Group B.
5. User verifies that Group A now has 1 tab and Group B has 2 tabs.

### Drag tab outside to create a new group

1. User opens the Tab Groups view.
2. User has Group A with 2 tabs.
3. User drags a tab from Group A and drops it into the empty background area (`#groups`).
4. A new tab group (Group B) is automatically created at the drop location.
5. The dragged tab is placed inside the newly created Group B.
6. User verifies that Group A now has 1 tab, and the new Group B has 1 tab.

### Move tab between OS windows

1. User has Window A with Group A and a tab inside it.
2. User opens a new Window B with its own Tab Groups view.
3. User moves the tab from Window A to Window B (simulating an OS drag-and-drop between windows).
4. User verifies that the tab disappears from Window A's Group A.
5. User verifies that the tab successfully appears in Window B, and the extension state accurately reflects its new `windowId` and updated `groupId`.

### Toggle off native tab groups (Firefox only)

1. User opens the extension settings in Firefox.
2. User disables the "Use Native Tab Groups" (`useNativeGroups`) option.
3. User navigates back to the Tab Groups view and creates a new group and tab.
4. User verifies that the group is created and managed within the extension's UI.
5. User verifies that **no** native browser tab group is created in the actual Firefox tab bar.
