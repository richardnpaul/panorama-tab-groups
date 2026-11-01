import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { type BrowserContext, firefox } from '@playwright/test';
import ts from 'typescript';
import { isRecord, isString } from '../../../src/js/share/guards.js';

/**
 * A real Firefox that a test can ask things of. Extensions are loaded as
 * temporary add-ons; a "probe" extension does what the test asks with the API it
 * has and answers, over a server of the lab. Pages of the lab (`/page/<name>`)
 * give tabs an address and a title.
 */
interface Probe {
  /** Call `browser.<path>(...args)` in the probe; rejects with what the browser said if it failed */
  call: (apiPath: string, ...args: unknown[]) => Promise<unknown>;
}

export interface Lab {
  context: BrowserContext;
  /** The address of a page of the lab, which has the name as its title */
  pageUrl: (name: string) => string;
  /** The probe loaded with this name, which is a separate extension with a session of its own */
  probe: (name: string) => Probe;
  /** Load an extension from a folder, as a temporary add-on, while the browser runs */
  install: (directory: string) => Promise<void>;
  /**
   * Load an extension as it is, but with what its background writes to the console also sent
   * to the lab: a copy is made, with a script first that wraps `console`
   */
  installLogged: (
    directory: string,
    /** What the extension has in `storage.sync` before it starts, as if the user had chosen it */
    storedOptions?: Record<string, unknown>,
  ) => Promise<void>;
  /** What the extensions that were loaded with `installLogged` have written, `level: text` */
  logs: () => string[];
  close: () => Promise<void>;
}

interface Pending {
  command: { id: number; path: string; args: unknown[] };
  settle: (answer: Answer) => void;
}

interface Answer {
  ok: boolean;
  result?: unknown;
  error?: string;
}

const PERMISSIONS = ['tabs', 'tabHide', 'tabGroups', 'sessions', 'storage'];

/** The probe, compiled, as the folder of an extension of its own */
function writeProbe(directory: string, name: string, port: number): string {
  const source = fs.readFileSync(
    path.join(import.meta.dirname, 'probe.ts'),
    'utf8',
  );
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  const folder = path.join(directory, `probe-${name}`);
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, 'background.js'),
    `const LAB_PORT = ${String(port)};\nconst LAB_NAME = ${JSON.stringify(name)};\n${outputText}`,
  );
  fs.writeFileSync(
    path.join(folder, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: `Probe ${name}`,
      version: '1.0',
      browser_specific_settings: {
        gecko: {
          id: `probe-${name}@lab.test`,
          data_collection_permissions: { required: ['none'] },
        },
      },
      permissions: PERMISSIONS,
      host_permissions: ['http://127.0.0.1/*'],
      background: { scripts: ['background.js'], type: 'module' },
    }),
  );
  return folder;
}

/** The server of the lab: what the probes are asked, what they answer, and the pages */
function startServer() {
  const logs: string[] = [];
  let nextId = 1;
  const queues = new Map<string, Pending[]>();
  const waiting = new Map<string, (pending: Pending) => void>();
  const asked = new Map<number, Pending>();

  const queueOf = (probe: string): Pending[] => {
    const queue = queues.get(probe) ?? [];
    queues.set(probe, queue);
    return queue;
  };

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const probe = url.searchParams.get('probe') ?? '';

    if (url.pathname === '/next') {
      const ready = queueOf(probe).shift();
      const give = (pending: Pending): void => {
        asked.set(pending.command.id, pending);
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(pending.command));
      };
      if (ready !== undefined) {
        give(ready);
        return;
      }
      // Hold the question until there is something to ask
      const timer = setTimeout(() => {
        waiting.delete(probe);
        response.writeHead(204);
        response.end();
      }, 5000);
      waiting.set(probe, (pending) => {
        clearTimeout(timer);
        give(pending);
      });
      return;
    }

    if (url.pathname === '/result' && request.method === 'POST') {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
        if (isRecord(body) && typeof body.id === 'number') {
          const pending = asked.get(body.id);
          asked.delete(body.id);
          pending?.settle({
            ok: body.ok === true,
            result: body.result,
            ...(isString(body.error) ? { error: body.error } : {}),
          });
        }
        response.writeHead(204);
        response.end();
      });
      return;
    }

    if (url.pathname === '/log') {
      // Written to by a background that is not of this origin
      response.setHeader('Access-Control-Allow-Origin', '*');
      response.setHeader('Access-Control-Allow-Headers', '*');
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString());
        if (isRecord(body) && isString(body.level) && isString(body.text)) {
          logs.push(`${body.level}: ${body.text}`);
        }
        response.writeHead(204);
        response.end();
      });
      return;
    }

    if (url.pathname.startsWith('/page/')) {
      const title = decodeURIComponent(url.pathname.slice('/page/'.length));
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end(
        `<!doctype html><title>${title.replace(/[<&]/gu, '')}</title><p>${title.replace(/[<&]/gu, '')}`,
      );
      return;
    }

    response.writeHead(404);
    response.end();
  });

  const ask = (
    probe: string,
    apiPath: string,
    args: unknown[],
  ): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const pending: Pending = {
        command: { id: nextId, path: apiPath, args },
        settle: ({ ok, result, error }) => {
          if (ok) {
            resolve(result);
          } else {
            reject(new Error(error ?? 'The probe failed'));
          }
        },
      };
      nextId += 1;
      const receiver = waiting.get(probe);
      if (receiver === undefined) {
        queueOf(probe).push(pending);
      } else {
        waiting.delete(probe);
        receiver(pending);
      }
    });

  return { server, ask, logs };
}

/** Start Firefox with a profile of its own and the probes loaded */
export async function startLab({ probes }: { probes: string[] }): Promise<Lab> {
  const { server, ask, logs } = startServer();
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('The server of the lab is not listening');
  }
  const { port } = address;

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-'));
  const profile = path.join(directory, 'profile');
  fs.mkdirSync(profile);

  const { connectWithMaxRetries, findFreeTcpPort } =
    await import('playwright-webextext/dist/firefox_remote.js');
  let rdpPort = 0;

  const launch = async (): Promise<BrowserContext> => {
    rdpPort = await findFreeTcpPort();
    return firefox.launchPersistentContext(profile, {
      headless: true,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).flatMap(([key, value]) =>
            value === undefined ? [] : [[key, value]],
          ),
        ),
        MOZ_HEADLESS: '1',
      },
      args: ['--start-debugger-server', String(rdpPort)],
      firefoxUserPrefs: {
        'devtools.debugger.remote-enabled': true,
        'devtools.debugger.prompt-connection': false,
        'extensions.manifestV3.enabled': true,
        'xpinstall.signatures.required': false,
      },
    });
  };
  const context = await launch();

  // Connected only while an extension is loaded: a connection that stays open stops the
  // browser from reporting navigations to the pages of extensions
  const install = async (folder: string): Promise<void> => {
    const client = await connectWithMaxRetries({ port: rdpPort });
    try {
      await client.installTemporaryAddon(folder);
    } finally {
      client.disconnect();
    }
  };
  const installLogged = async (
    source: string,
    storedOptions: Record<string, unknown> = {},
  ): Promise<void> => {
    const copy = path.join(directory, `logged-${path.basename(source)}`);
    fs.cpSync(source, copy, { recursive: true });
    fs.writeFileSync(
      path.join(copy, 'lab-log.js'),
      `for (const level of ['debug', 'log', 'warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    const text = args.map((arg) => {
      try { return typeof arg === 'string' ? arg : JSON.stringify(arg) ?? String(arg); } catch { return String(arg); }
    }).join(' ');
    fetch('http://127.0.0.1:${String(port)}/log', { method: 'POST', body: JSON.stringify({ level, text }) }).catch(() => {});
  };
}`,
    );
    const manifestPath = path.join(copy, 'manifest.json');
    const manifest: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (!isRecord(manifest) || !isRecord(manifest.background)) {
      throw new Error('The manifest has no background to log');
    }
    const scripts: unknown = manifest.background.scripts;
    const existing: unknown[] = Array.isArray(scripts) ? scripts : [];
    const setup =
      Object.keys(storedOptions).length > 0 ? ['lab-storage.js'] : [];
    if (setup.length > 0) {
      // A module that is waited for before the next one runs, so the extension finds it in storage
      fs.writeFileSync(
        path.join(copy, 'lab-storage.js'),
        `await browser.storage.sync.set(${JSON.stringify(storedOptions)});`,
      );
    }
    manifest.background.scripts = ['lab-log.js', ...setup, ...existing];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest));
    await install(copy);
  };

  await probes.reduce(async (previous, name) => {
    await previous;
    await install(writeProbe(directory, name, port));
  }, Promise.resolve());

  return {
    context,
    pageUrl: (name) => `http://127.0.0.1:${String(port)}/page/${name}`,
    probe: (name) => ({
      call: (apiPath, ...args) => ask(name, apiPath, args),
    }),
    install,
    installLogged,
    logs: () => [...logs],
    async close() {
      await context.close();
      server.close();
      fs.rmSync(directory, { recursive: true, force: true });
    },
  };
}
