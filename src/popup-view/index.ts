import '../js/polyfill.js';
import { startPopup } from './start.js';

startPopup().catch((error: unknown) => {
  console.error('[Popup] Start-up failed:', error);
});
