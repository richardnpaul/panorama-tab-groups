/**
 * Native Groups Option Handler
 * Manages the toggle for using native browser tab groups
 */

import type { Messaging } from '../ports/messaging.js';
import type { OptionsStore } from '../ports/options.js';
import {
  browserModeOf,
  type BrowserMode,
  type Capabilities,
} from '../share/capabilities.js';
import { requireElementById } from '../share/dom.js';

export interface NativeGroupsOptionPorts {
  options: OptionsStore;
  messaging: Messaging;
  /** What the browser the page runs in can do */
  capabilities: Capabilities;
}

const FEEDBACK_VISIBLE_MS = 3000;

interface ModeDisplay {
  disabled: boolean;
  // null keeps the stored option
  checked: boolean | null;
  message: string;
  className: string;
  dimmed: boolean;
}

const MODE_DISPLAY: Record<BrowserMode, ModeDisplay> = {
  // Firefox 139+ with both APIs - fully functional
  hybrid: {
    disabled: false,
    checked: null,
    message:
      'Use native browser tab groups for visual organization and collapsing.',
    className: 'info-text',
    dimmed: false,
  },
  // Chrome/Edge - has tabGroups but no tabHide
  'collapse-only': {
    disabled: false,
    checked: true,
    message:
      'Native tab groups are not supported in this browser version (requires Tab Hiding API).',
    className: 'warning-text',
    dimmed: true,
  },
  // Old Firefox - has tabHide but no tabGroups
  legacy: {
    disabled: true,
    checked: false,
    message:
      'Native tab groups are not supported in this browser version. Please update to Firefox 139+ or use Chrome 89+.',
    className: 'warning-text',
    dimmed: true,
  },
  // No APIs available
  unsupported: {
    disabled: true,
    checked: false,
    message: 'Your browser does not support the required APIs for tab groups.',
    className: 'warning-text',
    dimmed: true,
  },
};

/**
 * Save the option, then tell the background to clean up or migrate. This is a
 * direct message because storage.onChanged is unreliable in MV3.
 */
async function persist(
  { options, messaging }: NativeGroupsOptionPorts,
  newValue: boolean,
): Promise<void> {
  await options.save({ useNativeGroups: newValue });
  await messaging.send({
    action: newValue ? 'migrateToHybridGroups' : 'cleanupNativeGroups',
  });
}

function showFeedback(newValue: boolean): void {
  const feedback = document.getElementById('nativeGroupsFeedback');
  if (feedback === null) {
    return;
  }
  feedback.textContent = newValue
    ? 'Native groups enabled. Migrating groups...'
    : 'Native groups disabled. Cleaning up...';
  feedback.style.display = 'block';

  setTimeout(() => {
    feedback.style.display = 'none';
  }, FEEDBACK_VISIBLE_MS);
}

function saveNativeGroupsOption(
  ports: NativeGroupsOptionPorts,
  newValue: boolean,
): void {
  persist(ports, newValue).catch((error: unknown) => {
    console.error('[Options] Failed to update native groups:', error);
  });
  showFeedback(newValue);
}

/**
 * Initialize the native groups option UI
 */
export default async function initNativeGroupsOption(
  ports: NativeGroupsOptionPorts,
): Promise<void> {
  const options = await ports.options.load();
  const checkbox = document.getElementById('useNativeGroups');
  const container = document.getElementById('nativeGroupsContainer');

  if (!(checkbox instanceof HTMLInputElement) || container === null) {
    return;
  }

  const warningText = requireElementById(HTMLElement, 'nativeGroupsWarning');
  const display = MODE_DISPLAY[browserModeOf(ports.capabilities)];

  checkbox.checked = display.checked ?? options.useNativeGroups;
  checkbox.disabled = display.disabled;
  warningText.textContent = display.message;
  warningText.className = display.className;
  if (display.dimmed) {
    container.style.opacity = '0.5';
  }

  checkbox.addEventListener('change', () => {
    saveNativeGroupsOption(ports, checkbox.checked);
  });
}
