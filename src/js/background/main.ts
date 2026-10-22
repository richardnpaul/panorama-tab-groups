import '../polyfill.js';
import { registerListeners } from '../adapters/browser/events.js';
import { composeBackground } from './compose.js';

// The listeners are added before anything is awaited: a background that is
// woken by an event must have its listener in place by then
const { handlers, init } = composeBackground();
registerListeners(browser, handlers, console);

init().catch((error: unknown) => {
  console.error('[Initialization] Start-up failed:', error);
});
