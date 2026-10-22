type ElementClass<T extends Element> = new () => T;

function describeFailure(
  type: { name: string },
  selector: string,
  found: boolean,
): Error {
  return new Error(
    found
      ? `Element is not an ${type.name}: ${selector}`
      : `Element not found: ${selector}`,
  );
}

/**
 * Find an element of the given class or fail with a message that names it.
 */
export function requireElement<T extends Element>(
  type: ElementClass<T>,
  selector: string,
  root: ParentNode = document,
): T {
  const element = root.querySelector(selector);
  if (!(element instanceof type)) {
    throw describeFailure(type, selector, element !== null);
  }
  return element;
}

export function requireElementById<T extends HTMLElement>(
  type: ElementClass<T>,
  id: string,
): T {
  const element = document.getElementById(id);
  if (!(element instanceof type)) {
    throw describeFailure(type, `#${id}`, element !== null);
  }
  return element;
}

/**
 * Like `requireElement`, but returns null when the element is missing or is of
 * another type, for elements that are optional.
 */
export function findElement<T extends Element>(
  type: ElementClass<T>,
  selector: string,
  root: ParentNode = document,
): T | null {
  const element = root.querySelector(selector);
  return element instanceof type ? element : null;
}

/**
 * Use an async function as an event listener. The browser ignores what a
 * listener returns, so a failure would otherwise go unnoticed.
 */
export function asListener(
  handler: (event: Event) => Promise<unknown>,
): (event: Event) => void {
  return (event) => {
    handler(event).catch((error: unknown) => {
      console.error('[Options] Event handler failed:', error);
    });
  };
}
