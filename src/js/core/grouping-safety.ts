export type Safety = { safe: true } | { safe: false; reason: string };

/**
 * Whether grouping would leave the window with no tab outside the group (the
 * browser may close a window whose only tab is grouped); the Panorama view
 * tab does not count as a tab.
 */
export function checkWindowSurvives(
  groupedCount: number,
  windowTabs: readonly {
    url: string | undefined;
    pendingUrl: string | undefined;
  }[],
  viewUrl: string,
): Safety {
  const otherTabs = windowTabs.filter(
    ({ url, pendingUrl }) => url !== viewUrl && pendingUrl !== viewUrl,
  );

  return groupedCount === otherTabs.length && otherTabs.length === 1
    ? {
        safe: false,
        reason: 'Would group only tab in window (window closure risk)',
      }
    : { safe: true };
}
