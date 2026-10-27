import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { buildForFirefox } from './lib/firefox-build.js';

buildForFirefox({
  distDir: 'dist',
  firefoxDir: 'dist-firefox',
  remove: (path) => {
    rmSync(path, { recursive: true, force: true });
  },
  copy: (source, destination) => {
    cpSync(source, destination, { recursive: true });
  },
  readText: (path) => readFileSync(path, 'utf8'),
  writeText: (path, text) => {
    writeFileSync(path, text);
  },
});
