/**
 * The probe: the background of a small extension that does what a test asks, in
 * the browser, with the API the extension has, and tells what came of it. A test
 * can then ask the real Firefox what it does (can a hidden tab be put in a tab
 * group? what does another extension see of my session values?) and keep the
 * answer as a test, which is what the fake browser of the unit tests is built on.
 *
 * It is compiled and given its port and its name by `lab.ts`, and loaded as a
 * temporary add-on; nothing here may import anything.
 */

declare const LAB_PORT: number;
declare const LAB_NAME: string;

interface Command {
  id: number;
  // The API to call, as a path from `browser`: "tabs.hide", "tabGroups.update"
  path: string;
  args: unknown[];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isCommand = (value: unknown): value is Command =>
  isObject(value) &&
  typeof value.id === 'number' &&
  typeof value.path === 'string' &&
  Array.isArray(value.args);

/** Call the function at the path with the arguments, as the extension would */
function call({ path, args }: Command): Promise<unknown> {
  const names = path.split('.');
  const method = names.pop() ?? '';
  const owner = names.reduce<unknown>(
    (api, name) => (isObject(api) ? api[name] : undefined),
    browser,
  );
  const fn = isObject(owner) ? owner[method] : undefined;
  if (typeof fn !== 'function') {
    throw new Error(`There is no browser.${path}`);
  }
  // The API calls need their owner as `this`
  const result: unknown = Reflect.apply(fn, owner, args);
  // Most calls give a promise, and some give the answer itself
  return Promise.resolve(result);
}

const base = `http://127.0.0.1:${String(LAB_PORT)}`;

async function answer(command: Command): Promise<void> {
  let body: { id: number; ok: boolean; result?: unknown; error?: string };
  try {
    body = { id: command.id, ok: true, result: await call(command) };
  } catch (error) {
    body = {
      id: command.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  await fetch(`${base}/result?probe=${LAB_NAME}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** Ask for the next thing to do; the server holds the question until there is one */
async function next(): Promise<void> {
  try {
    const response = await fetch(`${base}/next?probe=${LAB_NAME}`);
    if (response.status === 200) {
      const command: unknown = await response.json();
      if (isCommand(command)) {
        await answer(command);
      }
    }
  } catch {
    // The server is not there (yet, or any more); ask again
  }
  setTimeout(() => {
    next().catch(() => undefined);
  }, 20);
}

next().catch(() => undefined);
