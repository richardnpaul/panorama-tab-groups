// Force creation of native group for the active group
// Run this in the background console to test native group creation

(async () => {
  console.log('=== FORCING NATIVE GROUP CREATION ===\n');

  const windowId = (await browser.windows.getCurrent()).id;
  const groups = await browser.sessions.getWindowValue(windowId, 'groups');
  const activeGroup = await browser.sessions.getWindowValue(windowId, 'activeGroup');
  const activeGroupData = groups.find((g) => g.id === activeGroup);

  console.log(`Active group: ${activeGroup} - "${activeGroupData?.name}"`);
  console.log(`Current native ID: ${activeGroupData?.nativeGroupId || 'NONE'}`);

  // Get tabs for this group
  const tabs = await browser.tabs.query({ windowId });
  const groupTabIds = await Promise.all(tabs.map(async (tab) => {
    const tabGroupId = await browser.sessions.getTabValue(tab.id, 'groupId');
    if (tabGroupId === activeGroup) {
      return tab.id;
    }
    return null;
  }));

  const validTabIds = groupTabIds.filter((id) => id !== null);
  console.log(`Found ${validTabIds.length} tabs in active group`);

  if (validTabIds.length === 0) {
    console.log('❌ No tabs to group');
    return;
  }

  // Create native group
  const colors = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  const color = colors[activeGroup % colors.length];

  const nativeGroupId = await browser.tabs.group({
    tabIds: validTabIds,
  });

  console.log(`✓ Created native group ${nativeGroupId}`);

  // Update with title and color
  await browser.tabGroups.update(nativeGroupId, {
    title: activeGroupData.name || `Group ${activeGroup}`,
    color,
  });

  console.log(`✓ Updated native group with title "${activeGroupData.name}" and color ${color}`);

  // Save to session storage - create new array to trigger save
  const updatedGroups = groups.map((g) => {
    if (g.id === activeGroup) {
      return { ...g, nativeGroupId };
    }
    return g;
  });
  await browser.sessions.setWindowValue(windowId, 'groups', updatedGroups);

  console.log('✓ Saved nativeGroupId to session storage');

  // Verify
  const nativeGroups = await browser.tabGroups.query({ windowId });
  console.log('\n=== VERIFICATION ===');
  console.log(`Native groups: ${nativeGroups.length}`);
  nativeGroups.forEach((g) => console.log(`  ${g.id}: "${g.title}" (${g.color})`));

  const verifyGroups = await browser.sessions.getWindowValue(windowId, 'groups');
  verifyGroups.forEach((g) => {
    console.log(`Group ${g.id}: "${g.name}" -> Native ID: ${g.nativeGroupId || 'NONE'}`);
  });

  console.log('\n✅ COMPLETE');
})();
