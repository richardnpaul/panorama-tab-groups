# Full Specification for Tab Groups

This document serves as a detailed specification of the extension's current behavior based on the codebase.

## 1. Core Operating Modes

The extension detects browser capabilities and operates in one of three modes:

- **Hybrid** (Firefox 139+, Chrome 89+ with `tabs.hide` support): Uses both browser native tab groups and Firefox's `tabs.hide` API. Unfocused groups are hidden from the tab bar and collapsed native groups.
- **Collapse-Only** (Chrome/Edge): Relies purely on native browser tab groups. Inactive groups are collapsed but their tabs remain visible in the tab strip.
- **Legacy** (Firefox < 139): Uses only the `tabs.hide` API to completely hide inactive tabs.

## 2. Stored data

Everything the extension keeps is in the table below. A test (`tests/unit/stored-data.test.ts`) fails when this table and the code
disagree about which keys exist, so it is kept true.

| Key                             | Kept as           | Holds                                                                                               | Notes                                                                                                    |
| ------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `groups`                        | value of a window | the groups of the window, each with its name, place, and the native group it refers to              | the group for ungrouped tabs (`-2`) is in the list; a group id is only unique within a window            |
| `activeGroup`                   | value of a window | the id of the group that is shown                                                                   |                                                                                                          |
| `groupIndex`                    | value of a window | the next id for a group of the window                                                               | a counter for each window                                                                                |
| `layoutMode`                    | value of a window | `freeform` or `tiling`                                                                              |                                                                                                          |
| `groupId`                       | value of a tab    | the id of the group the tab is in                                                                   | `-1` is the Tab Groups view itself, `-2` a tab in no group                                               |
| `thumbnail`                     | value of a tab    | a picture of the tab and when it was taken                                                          | only where the browser has `tabs.captureTab` (Firefox); older versions stored the picture alone          |
| `hybridGroupsMigrationComplete` | `storage.local`   | whether the groups were given native tab groups, once                                               | switching native groups off clears it                                                                    |
| `__mock_sessions`               | `storage.local`   | in Chromium only: every value of a window and of a tab above, under the id of the window or the tab | never cleaned of closed tabs and windows; the ids change when the browser restores a session (see below) |
| `toolbarPosition`               | `storage.sync`    | where the toolbar of the view is                                                                    | the options are shared between devices                                                                   |
| `useNativeGroups`               | `storage.sync`    | whether native tab groups are used                                                                  |                                                                                                          |
| `shortcut`                      | `storage.sync`    | which keyboard shortcuts the user has switched off                                                  |                                                                                                          |
| `theme`                         | `storage.sync`    | `auto`, `light` or `dark`                                                                           |                                                                                                          |
| `view`                          | `storage.sync`    | `popup` or `freeform`                                                                               |                                                                                                          |
| `useDarkTheme`                  | `storage.sync`    | what versions that had only a dark and a light theme kept; read once, then replaced by `theme`      |                                                                                                          |

The values of a window and of a tab are **session values**. In Firefox they are `browser.sessions` values: the browser keeps them for
the extension that set them (another extension cannot read them), brings them back with a window or a tab that is restored, and
drops them with it. Chromium has none, so they are kept in `__mock_sessions`. A backup file (`type` `tgvView`, `version` 1) holds the
groups and tabs of each window by position, and is the only data that has a version.

**What was found about the stored data in a real browser** (`tests/e2e/chromium-stored-data.spec.ts`, Chromium 156): the values of
tabs and windows that are closed stay in `__mock_sessions`; and a tab and a window that a restored session brings back have **new
ids**, so the values under the old ids do not reach them (the extension's groups, names and places of a window are not found, and
it makes the window one new group). Native tab groups are restored by Chromium itself.

The special groups are:

- `-1`: the Tab Groups view itself.
- `-2` (`UNGROUPED_GROUP_ID`): a fallback group for tabs that are in none.

## 3. The Tab Groups View (`view.html` / `popup-view/index.html`)

The main interface for managing groups.

- **Layout Modes**:
  - `freeform`: Groups can be dragged around arbitrarily.
  - `tiling`: Groups are auto-arranged in a grid layout based on the number of groups.
- **Interactions**:
  - **Drag and Drop**: Users can drag tabs between groups, reorder tabs within a group, or drag groups to reposition them.
  - **Keyboard Navigation**: Arrow keys can navigate through tabs and groups, and `Enter` switches to the selected tab.
  - **Thumbnail Capture**: The view periodically captures and caches tab thumbnails (`tabs.captureTab`) in `browser.sessions`.
  - **Search**: An input field to filter tabs by title, automatically focusing the matched tab.
- **Group Management**: Double-clicking empty space or clicking the "New Group" button creates a new group. Double-clicking a group's title bar closes the group.

## 4. Background Lifecycle Management (`background.js`)

Handles browser events to keep extension state in sync with real browser tabs.

- **Tab Creation**: Newly created tabs inherit the current `activeGroup` for their window unless explicitly opened as a background tab. If native groups are enabled, the tab is added to the corresponding browser native group.
- **Visibility Toggling**: Changing the active group triggers a process to collapse/hide all tabs not in the newly active group, and show/uncollapse tabs in the active group.
- **Menu Actions**: A context menu allows users to move the active tab(s) to a different group without opening the Tab Groups view.

## 5. Multi-Window Support

The extension rigorously segregates state by `windowId`.

- Groups are isolated per-window.
- Cross-window grouping contamination is actively prevented by safety checks during native group creation.

## 6. Keyboard Shortcuts

Configurable commands:

- `_execute_action` (Default `Ctrl+Shift+F`): Toggle the Tab Groups Viewer popup/tab.
- `activate-next-group` (Default `Alt+W`): Switch to the next Tab Group.
- `activate-previous-group` (Default `Alt+Shift+W`): Switch to the previous Tab Group.
