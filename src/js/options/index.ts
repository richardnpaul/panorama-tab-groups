import '../polyfill.js';
import { asListener } from '../share/dom.js';
import { startOptions } from './start.js';

document.addEventListener('DOMContentLoaded', asListener(startOptions));
