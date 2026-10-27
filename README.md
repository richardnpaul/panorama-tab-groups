# Tab Groups Viewer

Effective Immediately: Feature Code Freeze while CI pipeline implemented to add linting and tests to clean code. Breaking changes potentially incoming

## Description

Tab Groups Viewer is an easy way to organize a lot of tabs. You can visually group related tabs and switch between groups.

Currently two different views on the groups are provided:

- freeform (classic) view
  <img src="readme/images/readme-view-freeform.png" alt="" />
- popup view
  <img src="readme/images/readme-view-popup.png" alt="" />

Tab Groups Viewer is an updated and maintained fork of [Panorama Tab Groups](https://github.com/projectdelphai/panorama-tab-groups) which itself was a fork of [Panorama View](https://github.com/photodiode/panorama-view) which was an implementation of the old [Panorama/Tab Groups add-on](https://addons.mozilla.org/en-US/firefox/addon/tab-groups-panorama/) which was deprecated with the new Firefox web extension system.

## Installation

Tab Groups Viewer is available as a Firefox Add-on [here](https://addons.mozilla.org/en-US/firefox/addon/tab-groups-viewer/). Just follow the link, click "Add to Firefox", and you're good to go.

## Usage

The default shortcut to switch to the viewer tab is Ctrl+Shift+F and you can to the next or previous tab group with Alt+W/Alt+Shift+W. Any of these shortcuts can be changed in the add-on preferences tab.

### Backups

The preferences tab can save all your groups to a file (`tgvView-backup-<date>-<time>.json`) and open one again. Backups
made before the add-on was renamed (their file name starts with `panoramaView-backup`, and the file says
`"type": "panoramaView"` inside) still import as they are; new backups are always saved under the new name. Backups
from the older Tab Groups add-on are converted when they are imported.

## Contribution

Contributions of all kind are welcome. For example:

- Bug reports and fixes
- Feature requests and solutions
- Translations corrections and additions

For more details look into the [contribution instructions](CONTRIBUTION.md).
