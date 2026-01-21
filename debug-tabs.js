// Debug utility for troubleshooting tab group issues
// Add this to background.js for debugging

async function debugTabState() {
  try {
    const windowId = (await browser.windows.getCurrent()).id;
    const allTabs = await browser.tabs.query({ currentWindow: true });
    const groups = await browser.sessions.getWindowValue(windowId, 'groups');
    const activeGroup = await browser.sessions.getWindowValue(windowId, 'activeGroup');

    console.log('=== TAB DEBUG STATE ===');
    console.log('Active Group:', activeGroup);
    console.log('Session Groups:', groups);

    console.log('\n=== TAB DETAILS ===');
    const tabDetails = await Promise.all(
      allTabs.map(async (tab) => {
        const sessionGroupId = await browser.sessions.getTabValue(tab.id, 'groupId');
        return {
          tab,
          sessionGroupId,
        };
      }),
    );

    tabDetails.forEach(({ tab, sessionGroupId }) => {
      console.log(`Tab ${tab.id}: "${tab.title}"`);
      console.log(`  - Session groupId: ${sessionGroupId}`);
      console.log(`  - Native groupId: ${tab.groupId}`);
      console.log(`  - Hidden: ${tab.hidden}`);
      console.log(`  - URL: ${tab.url}`);
      console.log('---');
    });

    // Check native tab groups
    try {
      const nativeGroups = await browser.tabGroups.query({ windowId });
      console.log('\n=== NATIVE TAB GROUPS ===');
      nativeGroups.forEach((group) => {
        console.log(`Native Group ${group.id}: "${group.title}" (${group.color})`);
      });
    } catch (error) {
      console.log('Native tabGroups API not available');
    }
  } catch (error) {
    console.error('Debug failed:', error);
  }
}

// Export for use in browser console
window.debugTabState = debugTabState;
