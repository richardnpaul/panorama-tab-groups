import { readdirSync, readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/** The names of what holds a text a person reads: a property of an element, an argument of a dialog, a field of a notification */
const TEXT_PROPERTIES = new Set([
  'textContent',
  'innerText',
  'title',
  'placeholder',
  'alt',
]);
const TEXT_FIELDS = new Set(['content', 'title', 'placeholder', 'alt']);
const DIALOGS = new Set(['alert', 'confirm', 'prompt', 'notify']);

// Words, as against a symbol, a number or an empty text
const hasWords = (text: string): boolean => /\p{L}{2}/u.test(text);

function sourceFiles(directory = 'src'): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      return entry.name === '_locales' ? [] : sourceFiles(path);
    }
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

/** The parts of the expression that are written out as text in the code, which is what a person would read */
function writtenTexts(node: ts.Expression): string[] {
  if (ts.isStringLiteralLike(node)) {
    return [node.text];
  }
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((s) => s.literal.text)];
  }
  if (ts.isConditionalExpression(node)) {
    return [...writtenTexts(node.whenTrue), ...writtenTexts(node.whenFalse)];
  }
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return [...writtenTexts(node.left), ...writtenTexts(node.right)];
  }
  if (ts.isParenthesizedExpression(node)) {
    return writtenTexts(node.expression);
  }
  return [];
}

const nameOf = (node: ts.Node): string | undefined =>
  ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined;

/** Where the code gives a person a text of its own, and not one of the messages */
function literalTextsIn(path: string): string[] {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];

  const check = (expression: ts.Expression, what: string): void => {
    const text = writtenTexts(expression).find(hasWords);
    if (text !== undefined) {
      const { line } = file.getLineAndCharacterOfPosition(
        expression.getStart(),
      );
      found.push(`${path}:${String(line + 1)} ${what} "${text.trim()}"`);
    }
  };

  const visit = (node: ts.Node): void => {
    // element.textContent = "..."
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      TEXT_PROPERTIES.has(node.left.name.text)
    ) {
      check(node.right, `sets ${node.left.name.text}`);
    }
    // alert("..."), window.confirm("..."), notify("...")
    if (ts.isCallExpression(node) && node.arguments[0] !== undefined) {
      const callee = ts.isPropertyAccessExpression(node.expression)
        ? node.expression.name.text
        : nameOf(node.expression);
      if (callee !== undefined && DIALOGS.has(callee)) {
        check(node.arguments[0], `tells with ${callee}`);
      }
    }
    // newElement('p', { content: "..." }), notifications.show(id, { title: "..." })
    if (ts.isPropertyAssignment(node)) {
      const name = nameOf(node.name);
      if (name !== undefined && TEXT_FIELDS.has(name)) {
        check(node.initializer, `gives ${name}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

// A template with a hole in it, written so that this file does not hold one in a plain string
const TEMPLATE = ['`before $', '{x} after`'].join('');

describe('texts in the code', () => {
  it('finds the files to look in', () => {
    expect(sourceFiles().length).toBeGreaterThan(100);
  });

  it('are all from messages: no text a person reads is written in the code', () => {
    // A text that has to be written in the code is added here, with the reason
    const allowed: string[] = [];

    const offenders = sourceFiles()
      .flatMap(literalTextsIn)
      .filter((offender) => !allowed.some((text) => offender.includes(text)));

    expect(offenders).toEqual([]);
  });

  describe('the check itself', () => {
    const only = (code: string): string[] => {
      const found: string[] = [];
      const file = ts.createSourceFile(
        'x.ts',
        code,
        ts.ScriptTarget.Latest,
        true,
      );
      file.forEachChild((statement) => {
        if (ts.isExpressionStatement(statement)) {
          found.push(...writtenTexts(statement.expression));
        }
      });
      return found;
    };

    it('reads the written parts of a text, a template and a choice between two', () => {
      expect(only("'plain'")).toEqual(['plain']);
      expect(only(TEMPLATE)).toEqual(['before ', ' after']);
      expect(only("a ? 'one' : 'two'")).toEqual(['one', 'two']);
      expect(only("'left' + x + 'right'")).toEqual(['left', 'right']);
      expect(only("('wrapped')")).toEqual(['wrapped']);
    });

    it('reads nothing from what is not written in the code', () => {
      expect(only('call()')).toEqual([]);
      expect(only('a - b')).toEqual([]);
    });
  });
});
