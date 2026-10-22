import { extname } from 'node:path';

// Extensions that tsc compiles into dist, so they must not be copied verbatim
export const COMPILED_EXTENSIONS = ['.js', '.ts'];

export function createStaticAssetFilter(isDirectory) {
  return (sourcePath) =>
    isDirectory(sourcePath) ||
    !COMPILED_EXTENSIONS.includes(extname(sourcePath));
}

export function copyStatic({ srcDir, distDir, cp, isDirectory }) {
  cp(srcDir, distDir, {
    recursive: true,
    filter: createStaticAssetFilter(isDirectory),
  });
}
