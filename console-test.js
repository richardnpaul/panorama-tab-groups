// Simple console test - paste this into Firefox DevTools console
// Navigate to about:debugging -> This Firefox -> Panorama Tab Groups -> Inspect

(async () => {
  console.log('=== TESTING MIGRATION ===\n');

  // Reset migration flag
  const resetResponse = await browser.runtime.sendMessage({
    action: 'resetMigration',
  });
  console.log('✓ Reset migration flag:', resetResponse);

  // Trigger migration
  const response = await browser.runtime.sendMessage({
    action: 'migrateToHybridGroups',
  });
  console.log('Migration response:', response);

  // Check results
  const currentWindow = await browser.windows.getCurrent();
  const groups = await browser.sessions.getWindowValue(currentWindow.id, 'groups');

  console.log('\n=== GROUPS AFTER MIGRATION ===');
  groups.forEach((g) => {
    console.log(`Group ${g.id}: "${g.name}" -> Native ID: ${g.nativeGroupId || 'NONE'}`);
  });

  // Check native groups
  try {
    const nativeGroups = await browser.tabGroups.query({ windowId: currentWindow.id });
    console.log('\n=== NATIVE TAB GROUPS ===');
    nativeGroups.forEach((g) => {
      console.log(`Native ${g.id}: "${g.title}" (${g.color})`);
    });
  } catch (error) {
    console.error('Could not query native groups:', error);
  }

  // Check tabs
  const tabs = await browser.tabs.query({ currentWindow: true });
  console.log('\n=== TAB ASSIGNMENTS ===');
  const tabInfo = await Promise.all(tabs.map(async (tab) => {
    const sessionGroupId = await browser.sessions.getTabValue(tab.id, 'groupId');
    return { id: tab.id, sessionGroupId, nativeGroupId: tab.groupId };
  }));
  tabInfo.forEach((info) => {
    console.log(`Tab ${info.id}: Session Group ${info.sessionGroupId}, Native Group ${info.nativeGroupId}`);
  });

  console.log('\n✅ TEST COMPLETE');
})();
