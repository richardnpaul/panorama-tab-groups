// Fix: Properly save the nativeGroupId
(async () => {
  const windowId = (await browser.windows.getCurrent()).id;
  const groups = await browser.sessions.getWindowValue(windowId, 'groups');
  const activeGroup = await browser.sessions.getWindowValue(windowId, 'activeGroup');

  console.log('Before update:', groups[activeGroup]);

  // Create NEW array with updated group
  const updatedGroups = groups.map((g) => {
    if (g.id === activeGroup) {
      return {
        ...g,
        nativeGroupId: 1766159817602096, // Use the ID from the previous output
      };
    }
    return g;
  });

  await browser.sessions.setWindowValue(windowId, 'groups', updatedGroups);
  console.log('✓ Saved');

  // Verify
  const verify = await browser.sessions.getWindowValue(windowId, 'groups');
  console.log('After update:', verify[activeGroup]);
})();
