import { describe, expect, it } from 'vitest';
import { createMemoryOptions } from '../../../../src/js/adapters/memory/options.js';
import { createDefaultOptions } from '../../../../src/js/core/options.js';
import { describeOptionsStoreContract } from '../../../support/options-contract.js';

const defaults = createDefaultOptions('0.8.12', false);

describeOptionsStoreContract(
  'memory',
  (stored) => createMemoryOptions({ defaults, stored }),
  defaults,
);

describe('adapters/memory/options.ts', () => {
  it('uses the defaults of a browser with native groups when given none', async () => {
    await expect(createMemoryOptions().load()).resolves.toEqual(
      createDefaultOptions('1.0', true),
    );
  });

  it('shows what is stored, as storage would hold it', async () => {
    const options = createMemoryOptions({ stored: { theme: 3 } });

    await options.save({ view: 'popup' });

    expect(options.stored).toEqual({ theme: 3, view: 'popup' });
  });

  it('keeps a copy of what it starts with', async () => {
    const stored = { shortcut: { a: { disabled: true } } };
    const options = createMemoryOptions({ stored });

    stored.shortcut.a.disabled = false;

    expect((await options.load()).shortcut).toEqual({ a: { disabled: true } });
  });
});
