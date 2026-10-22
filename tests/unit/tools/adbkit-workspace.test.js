import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const stubManifest = JSON.parse(
  readFileSync('tools/adbkit-stub/package.json', 'utf8'),
);
const webExtManifest = JSON.parse(
  readFileSync('node_modules/web-ext/package.json', 'utf8'),
);

describe('@devicefarmer/adbkit replacement', () => {
  it('resolves to the in-repo stub, not the published package', () => {
    expect(realpathSync(require.resolve('@devicefarmer/adbkit'))).toBe(
      realpathSync(resolve('tools/adbkit-stub/index.js')),
    );
  });

  it('is a private workspace package named like the real one', () => {
    expect(stubManifest.name).toBe('@devicefarmer/adbkit');
    expect(stubManifest.private).toBe(true);
  });

  it('has exactly the version web-ext pins, so npm links the workspace', () => {
    expect(stubManifest.version).toBe(
      webExtManifest.dependencies['@devicefarmer/adbkit'],
    );
  });
});
