// Test script to explore the browser.tabGroups API
// This is for research purposes to understand the native API

// Expected browser.tabGroups API methods:
// - browser.tabGroups.query(queryInfo)
// - browser.tabGroups.get(groupId)
// - browser.tabGroups.create(createProperties)
// - browser.tabGroups.update(groupId, updateProperties)
// - browser.tabGroups.move(groupId, moveProperties)
// - browser.tabGroups.remove(groupId)

// Expected events:
// - browser.tabGroups.onCreated
// - browser.tabGroups.onUpdated
// - browser.tabGroups.onMoved
// - browser.tabGroups.onRemoved

// Basic tabGroups integration example:
async function testTabGroupsAPI() {
  try {
    // Get all tab groups in current window
    const groups = await browser.tabGroups.query({ windowId: browser.windows.WINDOW_ID_CURRENT });
    console.log('Current tab groups:', groups);

    // Create a new tab group
    const newGroup = await browser.tabGroups.create({
      title: 'Test Group',
      color: 'blue',
      windowId: browser.windows.WINDOW_ID_CURRENT,
    });
    console.log('Created new group:', newGroup);

    // Add tabs to the group
    const tabs = await browser.tabs.query({ windowId: browser.windows.WINDOW_ID_CURRENT });
    if (tabs.length > 0) {
      await browser.tabs.group({
        tabIds: [tabs[0].id],
        groupId: newGroup.id,
      });
    }

    // Update group properties
    await browser.tabGroups.update(newGroup.id, {
      title: 'Updated Test Group',
      color: 'red',
    });
  } catch (error) {
    console.error('TabGroups API not available or error:', error);
  }
}

// Export for testing
window.testTabGroupsAPI = testTabGroupsAPI;

// Note: This is conceptual code for understanding the API
// The actual implementation would need to be integrated into the extension
