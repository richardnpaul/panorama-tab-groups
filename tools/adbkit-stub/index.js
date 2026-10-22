export const UNAVAILABLE_MESSAGE =
  'Android support (web-ext --target firefox-android) is disabled in this project: ' +
  '@devicefarmer/adbkit is replaced by a stub because its node-forge dependency ' +
  'has no fixed release. See CONTRIBUTION.md.';

export function createClient() {
  throw new Error(UNAVAILABLE_MESSAGE);
}

// web-ext reads the client factory from `ADBKit.default`
export default { default: { createClient } };
