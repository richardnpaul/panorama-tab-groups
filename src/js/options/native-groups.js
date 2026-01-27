/**
 * Native Groups Option Handler
 * Manages the toggle for using native browser tab groups
 */

import { loadOptions } from '../_share/options.js';

// Detect browser capabilities
const hasTabGroupsAPI =
  typeof browser.tabGroups?.query === 'function' &&
  typeof browser.tabs?.group === 'function';
const hasTabHide = typeof browser.tabs.hide !== 'undefined';

// Determine browser mode
let browserMode = 'unsupported';
if (hasTabHide && hasTabGroupsAPI) {
  browserMode = 'hybrid';
} else if (hasTabGroupsAPI) {
  browserMode = 'collapse-only';
} else if (hasTabHide) {
  browserMode = 'legacy';
}

/**
 * Save the native groups option and trigger appropriate action
 */
function saveNativeGroupsOption() {
  const checkbox = document.getElementById('useNativeGroups');
  const newValue = checkbox.checked;

  console.debug('[Options] saveNativeGroupsOption called, newValue:', newValue);

  // Save to storage
  browser.storage.sync
    .set({
      useNativeGroups: newValue,
    })
    .then(() => {
      console.debug(
        '[Options] storage.sync.set completed for useNativeGroups:',
        newValue,
      );

      // Trigger cleanup or migration via direct message (storage.onChanged unreliable in MV3)
      if (!newValue) {
        console.debug(
          '[Options] Sending cleanupNativeGroups message to background',
        );
        browser.runtime
          .sendMessage({
            action: 'cleanupNativeGroups',
          })
          .then((response) => {
            console.debug('[Options] Cleanup response:', response);
          })
          .catch((error) => {
            console.error('[Options] Failed to send cleanup message:', error);
          });
      } else {
        console.debug(
          '[Options] Sending migrateToHybridGroups message to background',
        );
        browser.runtime
          .sendMessage({
            action: 'migrateToHybridGroups',
          })
          .then((response) => {
            console.debug('[Options] Migration response:', response);
          })
          .catch((error) => {
            console.error('[Options] Failed to send migration message:', error);
          });
      }
    })
    .catch((error) => {
      console.error('[Options] Failed to save useNativeGroups:', error);
    });

  // Show feedback
  const feedback = document.getElementById('nativeGroupsFeedback');
  if (feedback) {
    feedback.textContent = newValue
      ? 'Native groups enabled. Migrating groups...'
      : 'Native groups disabled. Cleaning up...';
    feedback.style.display = 'block';

    // Hide after 3 seconds
    setTimeout(() => {
      feedback.style.display = 'none';
    }, 3000);
  }
}

/**
 * Initialize the native groups option UI
 */
export default async function initNativeGroupsOption() {
  const options = await loadOptions();
  const checkbox = document.getElementById('useNativeGroups');
  const container = document.getElementById('nativeGroupsContainer');
  const warningText = document.getElementById('nativeGroupsWarning');

  if (!checkbox || !container) {
    return;
  }

  // Set current value
  checkbox.checked = options.useNativeGroups || false;

  // Configure based on browser capabilities
  switch (browserMode) {
    case 'hybrid':
      // Firefox 139+ with both APIs - fully functional
      checkbox.disabled = false;
      warningText.textContent =
        'Use native browser tab groups for visual organization and collapsing.';
      warningText.className = 'info-text';
      break;

    case 'collapse-only':
      // Chrome/Edge - has tabGroups but no tabHide
      checkbox.disabled = false;
      warningText.textContent =
        'Native groups will be used for collapsing only. Tab hiding is not supported in this browser.';
      warningText.className = 'warning-text';
      break;

    case 'legacy':
      // Old Firefox - has tabHide but no tabGroups
      checkbox.disabled = true;
      checkbox.checked = false;
      warningText.textContent =
        'Native tab groups are not supported in this browser version. Please update to Firefox 139+ or use Chrome 89+.';
      warningText.className = 'error-text';
      container.style.opacity = '0.5';
      break;

    case 'unsupported':
    default:
      // No APIs available
      checkbox.disabled = true;
      checkbox.checked = false;
      warningText.textContent =
        'Your browser does not support the required APIs for tab groups.';
      warningText.className = 'error-text';
      container.style.opacity = '0.5';
      break;
  }

  // Attach event listener
  checkbox.addEventListener('change', saveNativeGroupsOption);
}
