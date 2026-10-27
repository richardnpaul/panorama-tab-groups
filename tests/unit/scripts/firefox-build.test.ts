import { describe, expect, it, vi } from 'vitest';
import {
  buildForFirefox,
  firefoxManifestOf,
  type FirefoxBuildDeps,
} from '../../../scripts/lib/firefox-build.js';

const manifest = {
  manifest_version: 3,
  name: 'Tab Groups Viewer',
  background: {
    scripts: ['js/background/main.js'],
    service_worker: 'js/background/main.js',
    type: 'module',
  },
  action: { default_title: 'Toggle' },
};

describe('scripts/lib/firefox-build.ts', () => {
  describe('firefoxManifestOf', () => {
    it('leaves out the service worker, which only Chromium uses', () => {
      expect(firefoxManifestOf(manifest).background).toEqual({
        scripts: ['js/background/main.js'],
        type: 'module',
      });
    });

    it('keeps everything else as it was', () => {
      const { background, ...rest } = firefoxManifestOf(manifest);

      expect(rest).toEqual({
        manifest_version: 3,
        name: 'Tab Groups Viewer',
        action: { default_title: 'Toggle' },
      });
      expect(background).toBeDefined();
    });

    it('does not change the manifest it was given', () => {
      const original = structuredClone(manifest);

      firefoxManifestOf(manifest);

      expect(manifest).toEqual(original);
    });

    it('accepts a manifest that has no service worker already', () => {
      const { service_worker: ignored, ...background } = manifest.background;

      expect(firefoxManifestOf({ ...manifest, background }).background).toEqual(
        background,
      );
    });

    it.each([
      ['it is not an object', 'text'],
      ['it is null', null],
      ['it has no background', { name: 'x' }],
      ['the background is not an object', { background: 'x' }],
    ])('fails when %s', (_name, bad) => {
      expect(() => firefoxManifestOf(bad)).toThrow(
        'The manifest has no background',
      );
    });

    it.each([
      ['has no scripts', { service_worker: 'a.js' }],
      ['has scripts that are not a list', { scripts: 'a.js' }],
    ])(
      'fails when the background %s, which Firefox needs',
      (_name, background) => {
        expect(() => firefoxManifestOf({ background })).toThrow(
          'The manifest has no background.scripts for Firefox',
        );
      },
    );
  });

  describe('buildForFirefox', () => {
    function setUp(text = JSON.stringify(manifest)) {
      const calls: string[] = [];
      const written: Record<string, string> = {};
      const deps: FirefoxBuildDeps = {
        distDir: 'in',
        firefoxDir: 'out',
        remove: vi.fn((path: string) => {
          calls.push(`remove ${path}`);
        }),
        copy: vi.fn((source: string, destination: string) => {
          calls.push(`copy ${source} ${destination}`);
        }),
        readText: vi.fn((path: string) => {
          calls.push(`read ${path}`);
          return text;
        }),
        writeText: vi.fn((path: string, content: string) => {
          calls.push(`write ${path}`);
          written[path] = content;
        }),
      };
      return { deps, calls, written };
    }

    it('copies the build over an empty folder, then rewrites the manifest there', () => {
      const { deps, calls } = setUp();

      buildForFirefox(deps);

      expect(calls).toEqual([
        'remove out',
        'copy in out',
        'read out/manifest.json',
        'write out/manifest.json',
      ]);
    });

    it('writes the manifest for Firefox as formatted JSON ending in a newline', () => {
      const { deps, written } = setUp();

      buildForFirefox(deps);

      expect(written['out/manifest.json']).toBe(
        `${JSON.stringify(firefoxManifestOf(manifest), null, 2)}\n`,
      );
    });

    it('does not write a manifest Firefox cannot use', () => {
      const { deps, written } = setUp('{"background": {}}');

      expect(() => {
        buildForFirefox(deps);
      }).toThrow('background.scripts');
      expect(written).toEqual({});
    });
  });
});
