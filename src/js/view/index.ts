import '../polyfill.js';
import { startView } from './start.js';

startView().catch((error: unknown) => {
  console.error('[View] Start-up failed:', error);
});
