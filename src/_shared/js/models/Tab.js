async function getGroupId(Tab) {
  return browser.sessions.getTabValue(Tab.id, 'groupId');
}

export default class Tab {
  constructor(tab) {
    Object.assign(this, tab);
    this.groupId = null;
  }

  static async create(tab) {
    const instance = new Tab(tab);
    instance.groupId = await getGroupId(instance);
    return instance;
  }

  async open() {
    await browser.tabs.update(this.id, { active: true });
  }

  async remove() {
    await browser.tabs.remove(this.id);
  }
}
