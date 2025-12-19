# Migration Testing Plan

## Test Environment Setup

The extension is now running in development mode with DevTools open.

## Pre-Migration State

### 1. Check Current Groups
Open the browser console (F12) and run:
```javascript
// Get current window groups
const currentWindow = await browser.windows.getCurrent();
const groups = await browser.sessions.getWindowValue(currentWindow.id, 'groups');
console.log('Current groups:', groups);

// Check migration status
const migrationStatus = await browser.storage.local.get('hybridGroupsMigrationComplete');
console.log('Migration complete:', migrationStatus.hybridGroupsMigrationComplete);
```

## Migration Test Scenarios

### Scenario 1: Fresh Installation
**Expected:** Migration creates native groups for all existing panorama groups

**Steps:**
1. Create 3-4 panorama groups with tabs
2. Check groups have `nativeGroupId: undefined`
3. Restart extension or reload
4. Verify migration ran
5. Check groups now have `nativeGroupId` property

**Verification:**
```javascript
// After migration
const groups = await browser.sessions.getWindowValue((await browser.windows.getCurrent()).id, 'groups');
groups.forEach(g => console.log(`Group ${g.id}: ${g.name} -> Native: ${g.nativeGroupId}`));
```

### Scenario 2: Already Migrated
**Expected:** Migration skips, no changes made

**Steps:**
1. Run migration once
2. Note the `nativeGroupId` values
3. Trigger migration again manually
4. Verify `nativeGroupId` values unchanged

**Manual Trigger:**
```javascript
const response = await browser.runtime.sendMessage({action: 'migrateToHybridGroups'});
console.log('Migration response:', response);
```

### Scenario 3: Multiple Windows
**Expected:** Each window migrated independently

**Steps:**
1. Open 2+ browser windows
2. Create groups in each window
3. Trigger migration
4. Verify each window's groups have native counterparts

**Verification:**
```javascript
const windows = await browser.windows.getAll();
for (const win of windows) {
  const groups = await browser.sessions.getWindowValue(win.id, 'groups');
  console.log(`Window ${win.id}:`, groups?.map(g => ({id: g.id, nativeGroupId: g.nativeGroupId})));
}
```

### Scenario 4: Active vs Inactive Groups
**Expected:** Only active group tabs assigned to native groups

**Steps:**
1. Create 3 groups with 2-3 tabs each
2. Activate group 0
3. Run migration
4. Check which tabs are in native groups

**Verification:**
```javascript
// Check which tabs are in native groups
const tabs = await browser.tabs.query({currentWindow: true});
tabs.forEach(t => {
  console.log(`Tab ${t.id}: "${t.title}" -> Native Group: ${t.groupId}`);
});
```

### Scenario 5: Color Assignment
**Expected:** Groups get assigned colors in cycling pattern

**Steps:**
1. Create 10+ groups
2. Run migration
3. Verify native groups have colors

**Verification:**
```javascript
try {
  const nativeGroups = await browser.tabGroups.query({windowId: (await browser.windows.getCurrent()).id});
  nativeGroups.forEach(g => console.log(`Native Group ${g.id}: ${g.title} (${g.color})`));
} catch (e) {
  console.log('Native tabGroups not available:', e);
}
```

### Scenario 6: Migration Failure Recovery
**Expected:** Migration can retry after failure

**Steps:**
1. Reset migration flag
2. Force an error condition
3. Verify migration doesn't mark complete
4. Fix error
5. Verify migration retries successfully

**Reset Migration:**
```javascript
await browser.runtime.sendMessage({action: 'resetMigration'});
console.log('Migration flag reset');
```

## Visual Testing

### Test the Panorama View
1. Open panorama view (Ctrl+Shift+F)
2. Verify all groups visible
3. Verify all tabs appear in correct groups
4. Switch between groups
5. Verify tabs show/hide correctly

### Test Native Tab Groups UI
1. Look at Firefox tab bar
2. Verify active group tabs show in native group
3. Verify native group has correct name
4. Verify native group has assigned color
5. Switch panorama groups
6. Verify native group updates

## Integration Testing

### Test Tab Operations

**Create New Tab:**
```javascript
// Should create in active group
const tab = await browser.tabs.create({url: 'https://example.com'});
const groupId = await browser.sessions.getTabValue(tab.id, 'groupId');
console.log('New tab assigned to group:', groupId);
```

**Move Tab Between Groups:**
```javascript
// Use panorama view context menu to move tab
// Verify tab appears in correct native group
```

**Delete Group:**
```javascript
// Delete group in panorama view
// Verify native group removed
// Verify tabs handled correctly
```

## Performance Testing

### Test Large Number of Groups
1. Create 20+ groups
2. Each with 5+ tabs
3. Run migration
4. Measure time taken
5. Verify memory usage acceptable

**Console Timer:**
```javascript
console.time('migration');
await browser.runtime.sendMessage({action: 'migrateToHybridGroups'});
console.timeEnd('migration');
```

## Edge Cases

### Test Edge Conditions
- [ ] Empty groups (no tabs)
- [ ] Group with only pinned tabs
- [ ] Group with 100+ tabs
- [ ] Unicode characters in group names
- [ ] Very long group names (50+ chars)

### Test Error Handling
- [ ] Native API unavailable
- [ ] Window closed during migration
- [ ] Tab closed during migration
- [ ] Storage quota exceeded

## Migration Status Page Testing

1. Open `src/migration-status.html` as extension page
2. Verify status shows correctly
3. Click "Run Migration Now"
4. Verify status updates
5. Click "Reset Migration Flag"
6. Verify can re-run migration

## Console Logging Verification

During migration, you should see logs like:
```
Starting migration to hybrid tab groups...
Migrating N groups for window X
Created native group Y for panorama group Z
Assigned M tabs to native group Y
Migration complete for window X
Hybrid groups migration completed successfully!
```

## Rollback Testing

If migration causes issues:
```javascript
// Reset to pre-migration state
await browser.storage.local.set({hybridGroupsMigrationComplete: false});

// Remove native groups
const groups = await browser.sessions.getWindowValue((await browser.windows.getCurrent()).id, 'groups');
const cleanedGroups = groups.map(g => {
  const {nativeGroupId, ...rest} = g;
  return rest;
});
await browser.sessions.setWindowValue((await browser.windows.getCurrent()).id, 'groups', cleanedGroups);
```

## Success Criteria

✅ All existing groups have `nativeGroupId` property
✅ Native groups visible in Firefox tab bar
✅ Active group tabs assigned to native group
✅ Inactive group tabs not in native groups
✅ Panorama view shows all tabs correctly
✅ Tab hide/show functionality works
✅ Migration marked complete in storage
✅ Second migration run skips (idempotent)
✅ Colors assigned to native groups
✅ No errors in console
✅ Extension performance acceptable

## Reporting Issues

If you find issues, capture:
1. Console errors/warnings
2. Screenshot of panorama view
3. Screenshot of native tab groups
4. Group data: `await browser.sessions.getWindowValue((await browser.windows.getCurrent()).id, 'groups')`
5. Steps to reproduce
