# Full Specification for Tab Groups Tab Groups

This document serves as a detailed specification of the extension's current behavior based on the codebase.

## 1. Core Operating Modes

The extension detects browser capabilities and operates in one of three modes:

- **Hybrid** (Firefox 139+, Chrome 89+ with `tabs.hide` support): Uses both browser native tab groups and Firefox's `tabs.hide` API. Unfocused groups are hidden from the tab bar and collapsed native groups.
- **Collapse-Only** (Chrome/Edge): Relies purely on native browser tab groups. Inactive groups are collapsed but their tabs remain visible in the tab strip.
- **Legacy** (Firefox < 139): Uses only the `tabs.hide` API to completely hide inactive tabs.

## 2. State Management (`StateManager`)

State is managed across two browser storage mechanisms to handle MV3 service worker lifecycles:

- **Ephemeral State (`browser.sessions`)**: Fast, per-window/per-tab access.
  - Window-level: `groups` (array of group objects), `activeGroup`, `groupIndex`.
  - Tab-level: `groupId`.
- **Persistent State (`browser.storage.local`)**: Extension-level persistent state.
  - `backgroundState`: Flags like `openingView`.
  - `windowStates`: Tracks the Tab Groups `viewTabId` per window.
- **System Groups**: Includes special internal groups:
  - `-1`: The Tab Groups view itself.
  - `-2` (`UNGROUPED_GROUP_ID`): A fallback/system group for tabs not assigned to any group.

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
