import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type StorageArea,
  createSessionsEmulation,
} from '../../../src/js/adapters/browser/sessions-emulation.js';

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
function fakeStorage(): StorageArea {
  const data = new Map<string, unknown>();
  const tick = () =>
    new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
  return {
    get: async (name) => {
      await tick();
      return data.has(name) ? { [name]: structuredClone(data.get(name)) } : {};
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
});
