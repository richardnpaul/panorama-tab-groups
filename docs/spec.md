# Full Specification for Tab Groups

This document serves as a detailed specification of the extension's current behavior based on the codebase.

## 1. Core Operating Modes

The extension detects browser capabilities and operates in one of two modes:

- **Native groups** (Firefox 139+ with the option on, and always in Chrome/Edge): every group that has a tab has a native tab group,
  named and coloured like it; renaming either renames the other. The groups not shown are collapsed; no tab is hidden. In Chrome/Edge this is the only mode, and the
  option is shown checked and cannot be changed. The group for ungrouped tabs (`-2`) has no native group.
- **Legacy** (Firefox < 139, or Firefox 139+ with the option off): uses only the `tabs.hide` API to hide the tabs of the groups not
  shown.

The first run in Firefox 139+ decides the option once, when it was never set: off where a window has hidden tabs (another add-on's
groups, or this one's from before), and on otherwise, native tab groups found or not.

## 2. Stored data

Everything the extension keeps is in the table below. A test (`tests/unit/stored-data.test.ts`) fails when this table and the code
disagree about which keys exist, so it is kept true.

| Key                             | Kept as           | Holds                                                                                                         | Notes                                                                                                                                                                             |
| ------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groups`                        | value of a window | the groups of the window, each with its name and place; the link to its native group is apart (`nativeGroup`) | the group for ungrouped tabs (`-2`) is in the list; a group id is only unique within a window                                                                                     |
| `activeGroup`                   | value of a window | the id of the group that is shown                                                                             |                                                                                                                                                                                   |
| `groupIndex`                    | value of a window | the next id for a group of the window                                                                         | a counter for each window                                                                                                                                                         |
| `schemaVersion`                 | value of a window | the version of the shape of what is stored of the window and its tabs                                         | none before version 2; a window is brought to the current version when it is first used                                                                                           |
| `layoutMode`                    | value of a window | `freeform` or `tiling`                                                                                        |                                                                                                                                                                                   |
| `groupId`                       | value of a tab    | the id of the group the tab is in                                                                             | `-1` is the Tab Groups view itself, `-2` a tab in no group                                                                                                                        |
| `thumbnail`                     | value of a tab    | a picture of the tab and when it was taken                                                                    | only where the browser has `tabs.captureTab` (Firefox); older versions stored the picture alone                                                                                   |
| `hybridGroupsMigrationComplete` | `storage.local`   | whether the groups were given native tab groups, once                                                         | switching native groups off clears it                                                                                                                                             |
| `schemaVersion`                 | `storage.local`   | the version of the shape of the stored data of the profile                                                    | none before version 2; when it is older, a backup is written at start-up, then every window is brought up                                                                         |
| `closedAt`                      | value of a window | in Chromium only: when the window was closed, in milliseconds since the epoch                                 | the add-on's groups of a closed window are kept for a while, to rebuild a window that comes back (see below)                                                                      |
| `automaticBackups`              | `storage.local`   | the number of the next automatic backup file, and when the last one was written                               | the backups are files in `panorama-tab-groups-backups/` under the user's Downloads folder (see below)                                                                             |
| `__mock_sessions`               | `storage.local`   | in Chromium only: every value of a window and of a tab above, under the id of the window or the tab           | closed tabs and windows are let go of (see below); the ids change when the browser restores a session                                                                             |
| `nativeGroup`                   | `storage.session` | the link of a group to the browser's tab group that holds its tabs                                            | one key for each group, `nativeGroup:<window id>:<group id>`; gone when the browser closes, found again at start                                                                  |
| `updatePending`                 | `storage.session` | whether a new version of the add-on is waiting for it to start again, set once its backup is written          | cleared when the add-on starts again, which the browser also does when it updates it                                                                                              |
| `privateSessions`               | `storage.local`   | in Chromium only: every value of a private (incognito) window and tab, kept apart from `__mock_sessions`      | let go of when the window or tab closes, and at start-up for one that is not open (the browser quit or crashed first); never among the windows kept, nor in the automatic backups |
| `toolbarPosition`               | `storage.sync`    | where the toolbar of the view is                                                                              | the options are shared between devices                                                                                                                                            |
| `useNativeGroups`               | `storage.sync`    | whether native tab groups are used                                                                            |                                                                                                                                                                                   |
| `shortcut`                      | `storage.sync`    | which keyboard shortcuts the user has switched off                                                            |                                                                                                                                                                                   |
| `theme`                         | `storage.sync`    | `auto`, `light` or `dark`                                                                                     |                                                                                                                                                                                   |
| `view`                          | `storage.sync`    | `popup` or `freeform`                                                                                         |                                                                                                                                                                                   |
| `useDarkTheme`                  | `storage.sync`    | what versions that had only a dark and a light theme kept; read once, then replaced by `theme`                |                                                                                                                                                                                   |

The values of a window and of a tab are **session values**. In Firefox they are `browser.sessions` values: the browser keeps them for
the extension that set them (another extension cannot read them), brings them back with a window or a tab that is restored, and
drops them with it. Chromium has none, so they are kept in `__mock_sessions`, and those of private windows and tabs in
`privateSessions`: whether a window or tab is private is asked of the browser when its first value is stored, and one it cannot
tell about (it has closed) is kept apart too. An add-on cannot run when the browser closes, so what is kept apart is let go of as
each private window and tab closes, and at the next start for those the browser closed first. A backup file (`type` `tgvView`, `version` 1) holds the
groups and tabs of each window by position; its `version` is the format of the file, and stays 1 while the format only gains optional
fields.

**The version of the stored data** (`schemaVersion`) is a number of its own, in `storage.local` for the profile and as a value of each
window. Data stored before it existed is version 1. Version 2 stores groups without `containerId`. Version 3 hides no tab in native
mode (the tabs a window had hidden are shown, and its groups are given native groups again). Version 4 stores a group without the link
to its native group, which is kept in `storage.session` (`nativeGroup`) and found again from the tabs when the add-on starts. Version 5
gives a pinned tab no group (see "Pinned tabs"). A window
is brought up to the current version the first time anything of it is read or written after the add-on starts, its tabs with it, so
a window Firefox restores from long ago is brought up too. The backup written before the migration at start-up is
skipped when one was written within the hour, which holds the same data: a window that cannot be migrated is tried again at each
start, and a backup each time would push the older ones out. A stored version that is not a whole number from 1 is read as none.

**Pinned tabs** are in no group, and are never passed to the browser's grouping, which unpins them (`tabs.group` does, in Firefox and
Chromium; shown by `tests/e2e/chromium-pinned-tabs.spec.ts` and `firefox-pinned-tabs.spec.ts`). Pinning a tab takes it out of its group (the
browser does that, and the add-on clears the group it stored); a new tab that is pinned, or one that is moved to another window, gets none.
Unpinning a tab leaves it in the group for ungrouped tabs (`-2`) in native mode, where nothing is hidden and the person can move it, and in
the group the window shows when tabs are hidden. Sending a pinned tab to a group from the tab's menu unpins it, then moves it, as the
browsers' own menus do. A backup restores a pinned tab with no group.

**Deleting a group** closes its tabs, takes its native group apart, and forgets it. When it was the group the window shows, the window
goes to the lowest group that is left, and that group's tabs are shown. When it was the last of the user's, a new first group is made.

**Automatic backups.** The background writes the same file on its own, as `backup-1.json` to `backup-5.json` in turn
(each with a `savedAt` time), to `panorama-tab-groups-backups/` under the user's Downloads folder, replacing the file of that name
without asking, and takes it out of the browser's list of downloads. It leaves out private windows (where the user has let the
add-on run in them): a file the user did not ask for must not put the addresses of a private session on disk. A backup the user
saves from the options page keeps them, as they chose to save it. It writes one at once when the browser has an update of the
add-on waiting (`runtime.onUpdateAvailable`), and then starts the add-on again, which applies the update, once none of its pages is
open. Otherwise it writes one a few seconds after the groups change, if the last is an hour old or more; none before start-up has
put the groups back together. A change the view or the popup stores from the page is told to the
background by a `groupsChanged` message, which carries nothing (the backup reads the groups as they are stored).

**Chromium gives a tab and a window that are restored new ids** (`tests/e2e/chromium-stored-data.spec.ts`, Chromium 156), so the
values kept under the old ids do not reach them. It restores the native tab groups itself, with their titles. So:

- **A window that comes back with native groups and none of the add-on's is rebuilt** (`app/window-rebuild.ts`, Chromium only), at
  start-up before events are let through and when a window opens. Each native group is matched by its title to a group that was kept of
  a window that closed, and the windows that come back are paired with what was kept all at once, one to one, best fit first (the same set of titles;
  then the fewest groups left over; then the shown group being the open one; then the lower window id). The groups come back with their
  id, place, name and order, the groups that had no tab come back empty, and each tab follows its native group (a tab in none is
  ungrouped, a pinned one has no group). A title no kept group has, or one two kept groups share, gets a new group of its own. A window
  with nothing that fits has groups made of its native groups alone.
- **What is kept is pruned** (`app/closed-windows.ts`): a tab's values are let go of when the tab closes and at start-up for tabs that
  are not open; a window's groups are dated when it closes (`closedAt`) and kept while they are among the five most recent windows and
  under a week old. Windows that were open when the browser quit are dated at the next start-up, so the time the browser was closed
  does not count.
- **A tab that is reopened** is in the group that goes with the native group the browser puts it back in, else in the group the window
  shows. **A tab moved between native groups in the tab strip** is followed: it is in the group that goes with its new native group, or
  in the group for ungrouped tabs when it left its group. A native group that no group is linked to is left alone, and so is a tab the
  add-on is moving itself.

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
