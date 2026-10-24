import { TextEncoder as StandardTextEncoder } from '@exodus/bytes/encoding-lite.js';

// The new crypto family needs the standard UTF8 encoder on Hermes. Preserve an
// existing implementation and install no decoder or other platform globals.
if (typeof globalThis.TextEncoder === 'undefined') {
  Object.defineProperty(globalThis, 'TextEncoder', {
    value: StandardTextEncoder,
    writable: true,
    configurable: true,
  });
}
