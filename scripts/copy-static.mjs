import { cpSync, statSync } from 'node:fs';
import { copyStatic } from './lib/static-assets.mjs';

copyStatic({
  srcDir: 'src',
  distDir: 'dist',
  cp: cpSync,
  isDirectory: (sourcePath) => statSync(sourcePath).isDirectory(),
});
