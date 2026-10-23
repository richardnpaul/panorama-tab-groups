import '../polyfill.js';
import { startMigrationStatus } from './start.js';

startMigrationStatus().catch((error: unknown) => {
  console.error('[Migration] Start-up failed:', error);
});
