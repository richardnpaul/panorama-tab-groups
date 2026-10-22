// What the running browser can do. Firefox 139+ has both APIs, Chromium has
// only native tab groups, and older Firefox only has tab hiding.

export interface CapabilityApi {
  tabs?: { hide?: unknown; group?: unknown };
  tabGroups?: { query?: unknown };
}

export interface Capabilities {
  hasTabHide: boolean;
  hasTabGroups: boolean;
}

export type BrowserMode = 'hybrid' | 'collapse-only' | 'legacy' | 'unsupported';

export function detectCapabilities(api: CapabilityApi): Capabilities {
  return {
    hasTabHide: typeof api.tabs?.hide !== 'undefined', // Firefox 61+ only
    hasTabGroups:
      typeof api.tabGroups?.query === 'function' &&
      typeof api.tabs?.group === 'function', // Firefox 139+, Chrome 89+
  };
}

export function browserModeOf({
  hasTabHide,
  hasTabGroups,
}: Capabilities): BrowserMode {
  if (hasTabHide && hasTabGroups) {
    return 'hybrid'; // Best: hide/show + native groups
  }
  if (hasTabGroups) {
    return 'collapse-only'; // Chrome/Edge: native groups only
  }
  if (hasTabHide) {
    return 'legacy'; // Old Firefox: hide/show only
  }
  return 'unsupported';
}
