import { extname } from 'node:path';

// Extensions that tsc compiles into dist, so they must not be copied verbatim
export const COMPILED_EXTENSIONS = ['.js', '.ts'];

export type IsDirectory = (sourcePath: string) => boolean;

export type Copy = (
  source: string,
  destination: string,
  options: { recursive: true; filter: (sourcePath: string) => boolean },
) => void;

export function createStaticAssetFilter(
  isDirectory: IsDirectory,
): (sourcePath: string) => boolean {
  return (sourcePath) =>
    isDirectory(sourcePath) ||
    !COMPILED_EXTENSIONS.includes(extname(sourcePath));
}

export function copyStatic({
  srcDir,
  distDir,
  cp,
  isDirectory,
}: {
  srcDir: string;
  distDir: string;
  cp: Copy;
  isDirectory: IsDirectory;
}): void {
  cp(srcDir, distDir, {
    recursive: true,
    filter: createStaticAssetFilter(isDirectory),
  });
}
