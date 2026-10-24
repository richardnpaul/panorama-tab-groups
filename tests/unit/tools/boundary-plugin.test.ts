import { describe, expect, it, vi } from 'vitest';
import plugin, {
  WATCHED_PROPERTIES,
  type MemberNode,
  type RuleContext,
} from '../../../tools/oxlint/boundary-plugin.js';

const rule = plugin.rules['no-browser-storage'];

/** Visit the node the way the linter does, and give what was reported */
function visit(node: MemberNode): MemberNode[] {
  const reported: MemberNode[] = [];
  const context: RuleContext = {
    report: vi.fn<RuleContext['report']>(({ node: found }) => {
      reported.push(found);
    }),
  };
  rule.create(context).MemberExpression(node);
  return reported;
}

describe('tools/oxlint/boundary-plugin.ts', () => {
  it('is called panorama, which is the prefix of its rule in the configuration', () => {
    expect(plugin.meta.name).toBe('panorama');
    expect(Object.keys(plugin.rules)).toEqual(['no-browser-storage']);
  });

  it('watches the storage and the sessions of the browser', () => {
    expect(WATCHED_PROPERTIES).toEqual(['storage', 'sessions']);
  });

  it.each(WATCHED_PROPERTIES)('reports a member called %s', (name) => {
    const node = { property: { name } };

    expect(visit(node)).toEqual([node]);
  });

  it.each(['local', 'sync', 'tabs', 'Storage', 'sessionsX', 'xstorage', ''])(
    'lets a member called %j be',
    (name) => {
      expect(visit({ property: { name } })).toEqual([]);
    },
  );

  it('lets a member without a name be, such as a string or a number written out', () => {
    expect(visit({ property: {} })).toEqual([]);
  });

  it('reports with the message the configuration shows to the developer', () => {
    const report = vi.fn<RuleContext['report']>();
    const node = { property: { name: 'storage' } };

    rule.create({ report }).MemberExpression(node);

    expect(report).toHaveBeenCalledWith({ node, messageId: 'found' });
    expect(rule.meta.messages.found).toContain('only an adapter');
    expect(rule.meta.type).toBe('problem');
    expect(rule.meta.schema).toEqual([]);
  });
});
