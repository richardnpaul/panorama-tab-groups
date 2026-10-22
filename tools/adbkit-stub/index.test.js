import stub, { UNAVAILABLE_MESSAGE, createClient } from './index.js';

describe('tools/adbkit-stub', () => {
  it('explains why Android support is unavailable', () => {
    expect(UNAVAILABLE_MESSAGE).toBe(
      'Android support (web-ext --target firefox-android) is disabled in this project: ' +
        '@devicefarmer/adbkit is replaced by a stub because its node-forge dependency ' +
        'has no fixed release. See CONTRIBUTION.md.',
    );
  });

  it('refuses to create a client', () => {
    expect(() => createClient()).toThrow(Error);
    expect(() => createClient()).toThrow(UNAVAILABLE_MESSAGE);
  });

  it('exposes the client factory where web-ext reads it (ADBKit.default)', () => {
    expect(Object.keys(stub)).toEqual(['default']);
    expect(Object.keys(stub.default)).toEqual(['createClient']);
    expect(stub.default.createClient).toBe(createClient);
  });
});
