/**
 * Native Groups Option Handler
 * Manages the toggle for using native browser tab groups
 */

import {
  browserModeOf,
  detectCapabilities,
  type BrowserMode,
  type CapabilityApi,
} from '../share/capabilities.js';
import { requireElementById } from '../share/dom.js';
import { loadOptions } from '../share/options.js';

interface NativeGroupsApi extends CapabilityApi {
  storage: { sync: { set(items: Record<string, unknown>): Promise<void> } };
  runtime: { sendMessage(message: unknown): Promise<unknown> };
}

const api = (): NativeGroupsApi => browser;

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
async function persist(newValue: boolean): Promise<void> {
  await api().storage.sync.set({ useNativeGroups: newValue });
  await api().runtime.sendMessage({
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

function saveNativeGroupsOption(newValue: boolean): void {
  persist(newValue).catch((error: unknown) => {
    console.error('[Options] Failed to update native groups:', error);
  });
  showFeedback(newValue);
}

/**
 * Initialize the native groups option UI
 */
export default async function initNativeGroupsOption(): Promise<void> {
  const options = await loadOptions();
  const checkbox = document.getElementById('useNativeGroups');
  const container = document.getElementById('nativeGroupsContainer');

  if (!(checkbox instanceof HTMLInputElement) || container === null) {
    return;
  }

  const warningText = requireElementById(HTMLElement, 'nativeGroupsWarning');
  const display = MODE_DISPLAY[browserModeOf(detectCapabilities(api()))];

  checkbox.checked = display.checked ?? options.useNativeGroups;
  checkbox.disabled = display.disabled;
  warningText.textContent = display.message;
  warningText.className = display.className;
  if (display.dimmed) {
    container.style.opacity = '0.5';
  }

  checkbox.addEventListener('change', () => {
    saveNativeGroupsOption(checkbox.checked);
  });
}
