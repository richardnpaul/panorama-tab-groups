import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type StorageArea,
  createSessionsEmulation,
} from '../../../src/js/adapters/browser/sessions-emulation.js';
import { isRecord } from '../../../src/js/share/guards.js';

// The emulation of `browser.sessions` values that Chromium gets (storage.local, one object that is
// read and written whole by every call) must do what the real thing does: a value is what was last
// set, and removing it takes it away. It is held to that for any run of calls, one after the
// other and all at once, against a plain map.

type Scope = 'tab' | 'window';

type Operation =
  | { kind: 'set'; scope: Scope; id: number; key: string; value: unknown }
  | { kind: 'get'; scope: Scope; id: number; key: string }
  | { kind: 'remove'; scope: Scope; id: number; key: string };

// Few ids and keys, so that the calls meet
const id = fc.integer({ min: 1, max: 3 });
const key = fc.constantFrom('groupId', 'groups', 'thumbnail');
const scope = fc.constantFrom<Scope>('tab', 'window');
const value = fc.jsonValue();

const operation: fc.Arbitrary<Operation> = fc.oneof(
  fc.record({
    kind: fc.constant<'set'>('set'),
    scope,
    id,
    key,
    value,
  }),
  fc.record({ kind: fc.constant<'get'>('get'), scope, id, key }),
  fc.record({ kind: fc.constant<'remove'>('remove'), scope, id, key }),
);

/** `storage.local` as the browser has it: values are copies, and a call takes time */
function fakeStorage(data = new Map<string, unknown>()): StorageArea {
  const tick = () =>
    new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  return {
    get: async (names) => {
      await tick();
      return Object.fromEntries(
        names.flatMap((name) =>
          data.has(name) ? [[name, structuredClone(data.get(name))]] : [],
        ),
      );
    },
    set: async (items) => {
      await tick();
      Object.entries(items).forEach(([name, content]) => {
        data.set(name, structuredClone(content));
      });
    },
  };
}

/** What a plain map says a call gives, and the change it makes */
function modelOf() {
  const kept = new Map<string, unknown>();
  return (call: Operation): unknown => {
    const slot = `${call.scope}:${String(call.id)}:${call.key}`;
    if (call.kind === 'set') {
      kept.set(slot, structuredClone(call.value));
      return undefined;
    }
    if (call.kind === 'remove') {
      kept.delete(slot);
      return undefined;
    }
    return kept.get(slot);
  };
}

function run(
  emulation: ReturnType<typeof createSessionsEmulation>,
  call: Operation,
): Promise<unknown> {
  if (call.scope === 'tab') {
    switch (call.kind) {
      case 'set':
        return emulation.setTabValue(call.id, call.key, call.value);
      case 'remove':
        return emulation.removeTabValue(call.id, call.key);
      default:
        return emulation.getTabValue(call.id, call.key);
    }
  }
  switch (call.kind) {
    case 'set':
      return emulation.setWindowValue(call.id, call.key, call.value);
    case 'remove':
      return emulation.removeWindowValue(call.id, call.key);
    default:
      return emulation.getWindowValue(call.id, call.key);
  }
}

describe('adapters/browser/sessions-emulation.ts, for any run of calls', () => {
  it('gives each get what a map would, when the calls are made one after the other', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(operation, { maxLength: 30 }),
        async (calls) => {
          const storage = fakeStorage();
          const emulation = createSessionsEmulation(() => storage);
          const model = modelOf();

          const seen: unknown[] = [];
          const expected: unknown[] = [];
          await calls.reduce(async (previous, call) => {
            await previous;
            seen.push(await run(emulation, call));
            expected.push(model(call));
          }, Promise.resolve());

          expect(seen).toEqual(expected);
        },
      ),
    );
  });

  it('gives each get what a map would, when the calls are made all at once, in the order they were made', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(operation, { maxLength: 30 }),
        async (calls) => {
          const storage = fakeStorage();
          const emulation = createSessionsEmulation(() => storage);
          const model = modelOf();

          const expected = calls.map(model);
          const seen = await Promise.all(
            calls.map((call) => run(emulation, call)),
          );

          expect(seen).toEqual(expected);
        },
      ),
    );
  });

  describe('with the values of private windows and tabs kept apart (odd ids are private)', () => {
    const isPrivate = (_scope: 'tabs' | 'windows', given: number) =>
      Promise.resolve(given % 2 === 1);

    // The ids of a scope under a key, as stored
    const idsUnder = (
      data: Map<string, unknown>,
      name: string,
      inScope: 'tabs' | 'windows',
    ): string[] => {
      const stored = data.get(name);
      const scoped = isRecord(stored) ? stored[inScope] : undefined;
      return isRecord(scoped) ? Object.keys(scoped) : [];
    };

    it('gives each get what a map would, keeps each id in one place, and lists no private one among those kept', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(
            fc.oneof(
              operation,
              fc.record({
                kind: fc.constant<'forget'>('forget'),
                scope,
                id,
              }),
            ),
            { maxLength: 30 },
          ),
          async (calls) => {
            const data = new Map<string, unknown>();
            const storage = fakeStorage(data);
            const emulation = createSessionsEmulation(
              () => storage,
              undefined,
              isPrivate,
            );
            const kept = new Map<string, unknown>();

            await calls.reduce(async (previous, call) => {
              await previous;
              if (call.kind === 'forget') {
                await (call.scope === 'tab'
                  ? emulation.removeTab(call.id)
                  : emulation.removeWindow(call.id));
                [...kept.keys()]
                  .filter((slot) =>
                    slot.startsWith(`${call.scope}:${String(call.id)}:`),
                  )
                  .forEach((slot) => kept.delete(slot));
                return;
              }
              const slot = `${call.scope}:${String(call.id)}:${call.key}`;
              const seen = await run(emulation, call);
              if (call.kind === 'set') {
                kept.set(slot, structuredClone(call.value));
              } else if (call.kind === 'remove') {
                kept.delete(slot);
              } else {
                expect(seen).toEqual(kept.get(slot));
              }
            }, Promise.resolve());

            (['tabs', 'windows'] as const).forEach((inScope) => {
              const apart = idsUnder(data, 'privateSessions', inScope);
              const others = idsUnder(data, '__mock_sessions', inScope);
              expect(apart.filter((each) => others.includes(each))).toEqual([]);
              expect(others.every((each) => Number(each) % 2 === 0)).toBe(true);
              expect(apart.every((each) => Number(each) % 2 === 1)).toBe(true);
            });
          },
        ),
      );
    });

    it('takes the ids it moves apart out of the others, and reads what was kept apart already first', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.dictionary(fc.constantFrom('1', '2', '3'), fc.jsonValue()),
          fc.dictionary(fc.constantFrom('1', '2', '3'), fc.jsonValue()),
          fc.subarray([1, 2, 3]),
          async (before, already, moving) => {
            const data = new Map<string, unknown>([
              [
                '__mock_sessions',
                {
                  windows: Object.fromEntries(
                    Object.entries(before).map(([at, v]) => [at, { v }]),
                  ),
                  tabs: {},
                },
              ],
              [
                'privateSessions',
                {
                  windows: Object.fromEntries(
                    Object.entries(already).map(([at, v]) => [at, { v }]),
                  ),
                  tabs: {},
                },
              ],
            ]);
            const emulation = createSessionsEmulation(
              () => fakeStorage(data),
              undefined,
              isPrivate,
            );

            await emulation.setPrivate(moving, []);

            const others = idsUnder(data, '__mock_sessions', 'windows');
            expect(moving.filter((at) => others.includes(String(at)))).toEqual(
              [],
            );
            // What was kept apart already is what is read, being the newer
            await Promise.all(
              moving.map(async (at) => {
                const read = await emulation.getWindowValue(at, 'v');
                const expected =
                  String(at) in already
                    ? already[String(at)]
                    : before[String(at)];
                expect(read).toEqual(expected);
              }),
            );
          },
        ),
      );
    });
  });
});
