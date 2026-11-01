import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createBrowserGroupState,
  isGroup,
} from '../../../src/js/adapters/browser/group-state.js';
import { createBrowserViewState } from '../../../src/js/adapters/browser/view-state.js';
import { parseBackup } from '../../../src/js/core/backup.js';
import {
  createDefaultOptions,
  parseOptions,
} from '../../../src/js/core/options.js';
import type { Group } from '../../../src/js/ports/group-state.js';
import { createFakeSessions } from '../../support/fake-sessions.js';

// What is read from storage, from a file or from a message may be anything: an older version of the
// add-on wrote it, the user edited it, another extension or a bug wrote what it should not. Each reader
// is held to the same few things for any input: it does not throw, it gives data of the shape the rest
// of the code relies on, and reading what it gave out again changes nothing.

const defaults = createDefaultOptions('1.0', true);

describe('what is read from outside is read the same way for any input', () => {
  describe('a backup', () => {
    it('is read without failing from any text', () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          expect(() => parseBackup(text)).not.toThrow();
        }),
      );
    });

    it('is read without failing from any JSON, and is a backup or nothing', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (data) => {
          const backup = parseBackup(JSON.stringify(data));

          if (backup !== undefined) {
            expect(backup.file).toEqual({ type: 'tgvView', version: 1 });
            expect(Array.isArray(backup.windows)).toBe(true);
          }
        }),
      );
    });

    // Anything that looks like a backup of this add-on, with whatever in its windows
    const looksLikeBackup = fc.record({
      file: fc.constantFrom(
        { type: 'tgvView', version: 1 },
        { type: 'panoramaView', version: 1 },
      ),
      windows: fc.array(
        fc.oneof(
          fc.jsonValue(),
          fc.record({
            groups: fc.array(fc.jsonValue(), { maxLength: 4 }),
            tabs: fc.array(fc.jsonValue(), { maxLength: 4 }),
            activeGroup: fc.jsonValue(),
            groupIndex: fc.jsonValue(),
            windowPosition: fc.jsonValue(),
          }),
        ),
        { maxLength: 4 },
      ),
    });

    it('is read the same again once it is written out: what it kept of the file, it keeps', () => {
      fc.assert(
        fc.property(looksLikeBackup, (data) => {
          const first = parseBackup(JSON.stringify(data));
          expect(first).toBeDefined();

          const second = parseBackup(JSON.stringify(first));

          expect(second).toEqual(first);
        }),
      );
    });
  });

  describe('the options', () => {
    it('are read without failing from anything, and are whole', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (stored) => {
          const options = parseOptions(stored, defaults);

          expect(typeof options.theme).toBe('string');
          expect(typeof options.view).toBe('string');
          expect(typeof options.toolbarPosition).toBe('string');
          expect(typeof options.useNativeGroups).toBe('boolean');
          Object.values(options.shortcut).forEach((shortcut) => {
            expect(typeof shortcut.disabled).toBe('boolean');
          });
        }),
      );
    });

    it('are read the same again', () => {
      fc.assert(
        fc.property(fc.jsonValue(), (stored) => {
          const once = parseOptions(stored, defaults);

          expect(parseOptions(once, defaults)).toEqual(once);
        }),
      );
    });
  });

  describe('what a window and a tab keep', () => {
    /** The group state over sessions values, where `values` are what is stored under the keys */
    async function stateWith(values: {
      window?: Record<string, unknown>;
      tab?: Record<string, unknown>;
    }) {
      const sessions = createFakeSessions();
      await Promise.all([
        ...Object.entries(values.window ?? {}).map(([key, value]) =>
          sessions.api.sessions.setWindowValue(1, key, value),
        ),
        ...Object.entries(values.tab ?? {}).map(([key, value]) =>
          sessions.api.sessions.setTabValue(2, key, value),
        ),
      ]);
      return createBrowserGroupState(() => sessions.api);
    }

    it('are read without failing from any stored value, as a number or as nothing, and groups only from a list', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.jsonValue(),
          fc.jsonValue(),
          fc.jsonValue(),
          fc.jsonValue(),
          async (groups, activeGroup, groupIndex, groupId) => {
            const state = await stateWith({
              window: { groups, activeGroup, groupIndex },
              tab: { groupId },
            });

            const read = await Promise.all([
              state.getGroups(1),
              state.getActiveGroup(1),
              state.getGroupIndex(1),
              state.getTabGroup(2),
            ]);

            const [found, active, index, tabGroup] = read;
            expect(found === undefined || Array.isArray(found)).toBe(true);
            (found ?? []).forEach((group) => {
              expect(isGroup(group)).toBe(true);
            });
            [active, index, tabGroup].forEach((number) => {
              expect(number === undefined || Number.isFinite(number)).toBe(
                true,
              );
            });
          },
        ),
      );
    });

    const group: fc.Arbitrary<Group> = fc.record(
      {
        id: fc.integer({ min: -2, max: 1000 }),
        name: fc.string(),
        containerId: fc.string({ minLength: 1 }),
        rect: fc.record({
          x: fc.double({ noNaN: true, noDefaultInfinity: true }),
          y: fc.double({ noNaN: true, noDefaultInfinity: true }),
          w: fc.double({ noNaN: true, noDefaultInfinity: true }),
          h: fc.double({ noNaN: true, noDefaultInfinity: true }),
        }),
        windowId: fc.integer({ min: 1, max: 100 }),
        nativeGroupId: fc.oneof(fc.constant(null), fc.integer({ min: 1 })),
        lastMoved: fc.integer({ min: 0 }),
        isSystemGroup: fc.boolean(),
        tabCount: fc.integer({ min: 0, max: 1000 }),
      },
      { requiredKeys: ['id', 'name', 'containerId', 'rect'] },
    );

    it('give back the groups that were kept, as they were, whatever fields they have', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(group, { maxLength: 6 }), async (groups) => {
          const state = await stateWith({});

          await state.setGroups(1, groups);

          expect(await state.getGroups(1)).toEqual(groups);
        }),
      );
    });

    it('give back the numbers that were kept, and forget a tab group that was cleared', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: -2, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          fc.integer({ min: 0, max: 1000 }),
          async (tabGroup, active, index) => {
            const state = await stateWith({});

            await state.setTabGroup(2, tabGroup);
            await state.setActiveGroup(1, active);
            await state.setGroupIndex(1, index);

            expect(await state.getTabGroup(2)).toBe(tabGroup);
            expect(await state.getActiveGroup(1)).toBe(active);
            expect(await state.getGroupIndex(1)).toBe(index);
            await state.clearTabGroup(2);
            expect(await state.getTabGroup(2)).toBeUndefined();
          },
        ),
      );
    });
  });

  describe('a thumbnail and the layout of a window', () => {
    it('are read without failing from any stored value, as what they are or as nothing', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.jsonValue(),
          fc.jsonValue(),
          async (thumbnail, layoutMode) => {
            const sessions = createFakeSessions();
            await sessions.api.sessions.setTabValue(2, 'thumbnail', thumbnail);
            await sessions.api.sessions.setWindowValue(
              1,
              'layoutMode',
              layoutMode,
            );
            const state = createBrowserViewState(() => sessions.api);

            const picture = await state.thumbnail(2);
            const layout = await state.layoutMode(1);

            if (picture !== undefined) {
              expect(typeof picture.image).toBe('string');
            }
            expect([undefined, 'freeform', 'tiling']).toContain(layout);
          },
        ),
      );
    });
  });
});
