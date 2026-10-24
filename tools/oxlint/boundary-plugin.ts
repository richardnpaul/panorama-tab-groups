// A rule of our own for oxlint, which loads it as a plugin. Oxlint's plugin
// interface follows ESLint's; only the parts this rule uses are described here

/** The nodes of the syntax tree this rule reads */
export interface MemberNode {
  property: { name?: string };
}

export interface RuleContext {
  report(problem: { node: MemberNode; messageId: 'found' }): void;
}

/** The browser API the rule watches for: it holds the extension's state */
export const WATCHED_PROPERTIES = ['storage', 'sessions'];

const noBrowserStorage = {
  meta: {
    type: 'problem',
    messages: {
      found:
        'The browser is reached through a port; only an adapter or a composition root names it (see .oxlintrc.json)',
    },
    schema: [],
  },
  create: (context: RuleContext) => ({
    MemberExpression(node: MemberNode) {
      const { name } = node.property;
      if (name !== undefined && WATCHED_PROPERTIES.includes(name)) {
        context.report({ node, messageId: 'found' });
      }
    },
  }),
};

export default {
  meta: { name: 'panorama' },
  rules: { 'no-browser-storage': noBrowserStorage },
};
