// Migration Test Helper Script
// Paste this into the browser console (F12) for easy testing

window.migrationTest = {

  // Check current migration status
  async checkStatus() {
    console.log('=== MIGRATION STATUS ===');
    const status = await browser.storage.local.get('hybridGroupsMigrationComplete');
    console.log('Migration completed:', status.hybridGroupsMigrationComplete);

    const currentWindow = await browser.windows.getCurrent();
    const groups = await browser.sessions.getWindowValue(currentWindow.id, 'groups');

    console.log('\n=== GROUPS ===');
    if (!groups || groups.length === 0) {
      console.log('No groups found');
      return;
    }

    console.table(groups.map((g) => ({
      ID: g.id,
      Name: g.name,
      'Native ID': g.nativeGroupId || 'NOT MIGRATED',
      Status: g.nativeGroupId ? '✓' : '✗',
    })));
  },

  // Run migration manually
  async runMigration() {
    console.log('Starting manual migration...');
    try {
      const response = await browser.runtime.sendMessage({
        action: 'migrateToHybridGroups',
      });
      console.log('Migration result:', response);
      await this.checkStatus();
    } catch (error) {
      console.error('Migration failed:', error);
    }
  },

  // Reset migration flag
  async reset() {
    console.log('Resetting migration flag...');
    await browser.storage.local.set({ hybridGroupsMigrationComplete: false });
    console.log('Reset complete. You can now run migration again.');
    await this.checkStatus();
  },

  // Show all tabs and their group assignments
  async showTabs() {
    console.log('=== TAB ASSIGNMENTS ===');
    const tabs = await browser.tabs.query({ currentWindow: true });

    const tabData = await Promise.all(tabs.map(async (tab) => {
      const sessionGroupId = await browser.sessions.getTabValue(tab.id, 'groupId');
      return {
        ID: tab.id,
        Title: tab.title.substring(0, 40),
        'Session Group': sessionGroupId,
        'Native Group': tab.groupId || 'none',
        Hidden: tab.hidden ? 'yes' : 'no',
      };
    }));

    console.table(tabData);
  },

  // Show native tab groups (if API available)
  async showNativeGroups() {
    console.log('=== NATIVE TAB GROUPS ===');
    try {
      const currentWindow = await browser.windows.getCurrent();
      const nativeGroups = await browser.tabGroups.query({ windowId: currentWindow.id });

      if (nativeGroups.length === 0) {
        console.log('No native tab groups found');
        return;
      }

      console.table(nativeGroups.map((g) => ({
        ID: g.id,
        Title: g.title,
        Color: g.color,
        Collapsed: g.collapsed ? 'yes' : 'no',
      })));
    } catch (error) {
      console.warn('Native tabGroups API not available:', error.message);
    }
  },

  // Full diagnostic
  async diagnose() {
    console.clear();
    console.log('🔍 MIGRATION DIAGNOSTIC REPORT\n');

    await this.checkStatus();
    console.log('\n');
    await this.showTabs();
    console.log('\n');
    await this.showNativeGroups();

    console.log('\n=== QUICK ACTIONS ===');
    console.log('migrationTest.runMigration() - Run migration');
    console.log('migrationTest.reset() - Reset migration flag');
    console.log('migrationTest.checkStatus() - Check status');
    console.log('migrationTest.showTabs() - Show tab assignments');
    console.log('migrationTest.showNativeGroups() - Show native groups');
  },

  // Test scenario: Create test groups
  async createTestGroups(count = 3, tabsPerGroup = 2) {
    console.log(`Creating ${count} test groups with ${tabsPerGroup} tabs each...`);

    const promises = [];
    for (let i = 0; i < count; i += 1) {
      for (let j = 0; j < tabsPerGroup; j += 1) {
        promises.push(browser.tabs.create({
          url: `https://example.com/group${i}/tab${j}`,
          active: false,
        }));
      }
    }
    await Promise.all(promises);

    console.log('Test groups created. Open panorama view to organize them.');
  },

  // Verify migration succeeded
  async verify() {
    console.log('=== MIGRATION VERIFICATION ===');

    const currentWindow = await browser.windows.getCurrent();
    const groups = await browser.sessions.getWindowValue(currentWindow.id, 'groups');

    if (!groups || groups.length === 0) {
      console.log('❌ No groups found');
      return false;
    }

    let allMigrated = true;
    let nativeMismatch = false;

    groups.forEach((group) => {
      if (!group.nativeGroupId) {
        console.log(`❌ Group ${group.id} (${group.name}) - NOT MIGRATED`);
        allMigrated = false;
      } else {
        console.log(`✓ Group ${group.id} (${group.name}) -> Native ${group.nativeGroupId}`);
      }
    });

    // Check native groups exist
    try {
      const nativeGroups = await browser.tabGroups.query({ windowId: currentWindow.id });
      const nativeIds = new Set(nativeGroups.map((g) => g.id));

      groups.forEach((group) => {
        if (group.nativeGroupId && !nativeIds.has(group.nativeGroupId)) {
          console.log(`⚠ Group ${group.id} references non-existent native group ${group.nativeGroupId}`);
          nativeMismatch = true;
        }
      });
    } catch (error) {
      console.warn('Cannot verify native groups:', error.message);
    }

    const migrationStatus = await browser.storage.local.get('hybridGroupsMigrationComplete');
    const flagSet = migrationStatus.hybridGroupsMigrationComplete;

    console.log('\n=== RESULTS ===');
    console.log(`All groups migrated: ${allMigrated ? '✓' : '❌'}`);
    console.log(`Native groups match: ${!nativeMismatch ? '✓' : '❌'}`);
    console.log(`Migration flag set: ${flagSet ? '✓' : '❌'}`);

    const success = allMigrated && !nativeMismatch && flagSet;
    console.log(`\n${success ? '✅ MIGRATION SUCCESSFUL' : '❌ MIGRATION INCOMPLETE/FAILED'}`);

    return success;
  },
};

// Auto-run diagnostic
console.log('Migration test helper loaded!');
console.log('Run: window.migrationTest.diagnose() for full report');
console.log('     window.migrationTest.verify() to verify migration');

// Run initial diagnostic
window.migrationTest.diagnose();
