import { isRecord } from '../../src/js/share/guards.js';

/**
 * The manifest as Firefox should have it: Firefox runs the background from
 * `scripts` and ignores `service_worker`, which only Chromium uses, so it is
 * left out rather than reported by `web-ext lint` and by the add-on store
 */
export function firefoxManifestOf(manifest: unknown): Record<string, unknown> {
  if (!isRecord(manifest) || !isRecord(manifest.background)) {
    throw new Error('The manifest has no background');
  }
  const { service_worker: ignored, ...background } = manifest.background;
  if (!Array.isArray(background.scripts)) {
    throw new Error('The manifest has no background.scripts for Firefox');
  }
  return { ...manifest, background };
}

export interface FirefoxBuildDeps {
  /** The build for every browser, and where the one for Firefox goes */
  distDir: string;
  firefoxDir: string;
  remove: (path: string) => void;
  copy: (source: string, destination: string) => void;
  readText: (path: string) => string;
  writeText: (path: string, text: string) => void;
}

/** Copy the build to a folder of its own and give it the manifest for Firefox */
export function buildForFirefox({
  distDir,
  firefoxDir,
  remove,
  copy,
  readText,
  writeText,
}: FirefoxBuildDeps): void {
  remove(firefoxDir);
  copy(distDir, firefoxDir);
  const manifestPath = `${firefoxDir}/manifest.json`;
  const manifest: unknown = JSON.parse(readText(manifestPath));
  writeText(
    manifestPath,
    `${JSON.stringify(firefoxManifestOf(manifest), null, 2)}\n`,
  );
}
