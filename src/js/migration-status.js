// Migration Status Page JavaScript

async function checkMigrationStatus() {
  const statusDiv = document.getElementById('migration-status');

  try {
    const result = await browser.storage.local.get('hybridGroupsMigrationComplete');

    if (result.hybridGroupsMigrationComplete) {
      statusDiv.className = 'status-box success';
      statusDiv.textContent = '✓ Migration Complete - All groups have been migrated to hybrid system';
    } else {
      statusDiv.className = 'status-box warning';
      statusDiv.textContent = '⚠ Migration Pending - Groups have not been migrated yet';
    }
  } catch (error) {
    statusDiv.className = 'status-box warning';
    statusDiv.textContent = `Error checking migration status: ${error.message}`;
  }
}

async function loadGroups() {
  const container = document.getElementById('groups-container');
  container.innerHTML = '';

  try {
    const currentWindow = await browser.windows.getCurrent();
    const groups = await browser.sessions.getWindowValue(currentWindow.id, 'groups');

    if (!groups || groups.length === 0) {
      container.textContent = 'No groups found in current window';
      return;
    }

    groups.forEach((group) => {
      const groupDiv = document.createElement('div');
      groupDiv.className = `group-item ${group.nativeGroupId ? 'migrated' : 'not-migrated'}`;

      const status = group.nativeGroupId
        ? `✓ Migrated (Native ID: ${group.nativeGroupId})`
        : '✗ Not Migrated';

      groupDiv.innerHTML = `
        <strong>Group ${group.id}:</strong> ${group.name}<br>
        <small>Status: ${status}</small>
      `;

      container.appendChild(groupDiv);
    });
  } catch (error) {
    container.textContent = `Error loading groups: ${error.message}`;
  }
}

document.getElementById('run-migration').addEventListener('click', async () => {
  const button = document.getElementById('run-migration');
  button.disabled = true;
  button.textContent = 'Running migration...';

  try {
    const response = await browser.runtime.sendMessage({
      action: 'migrateToHybridGroups',
    });

    if (response.success) {
      alert('Migration completed successfully!');
    } else {
      alert(`Migration failed: ${response.message}`);
    }
  } catch (error) {
    alert(`Migration error: ${error.message}`);
  } finally {
    button.disabled = false;
    button.textContent = 'Run Migration Now';
    await checkMigrationStatus();
    await loadGroups();
  }
});

document.getElementById('reset-migration').addEventListener('click', async () => {
  // eslint-disable-next-line no-alert
  if (!window.confirm('Reset migration flag? This will allow migration to run again.')) {
    return;
  }

  try {
    const response = await browser.runtime.sendMessage({
      action: 'resetMigration',
    });

    if (response.success) {
      alert('Migration flag reset successfully!');
      await checkMigrationStatus();
    }
  } catch (error) {
    alert(`Reset error: ${error.message}`);
  }
});

// Initialize
checkMigrationStatus();
loadGroups();

// Refresh every 5 seconds
setInterval(() => {
  checkMigrationStatus();
  loadGroups();
}, 5000);
