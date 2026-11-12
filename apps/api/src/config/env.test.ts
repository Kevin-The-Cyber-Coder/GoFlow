import { describe, expect, it } from '@jest/globals';

import { loadConfig } from './env';

describe('loadConfig', () => {
  it('applies development defaults', () => {
    expect(loadConfig({})).toEqual({ nodeEnv: 'development', port: 3000 });
  });

  it('reads explicit values', () => {
    expect(loadConfig({ NODE_ENV: 'production', PORT: '8080' })).toEqual({
      nodeEnv: 'production',
      port: 8080,
    });
  });

  it('rejects an invalid NODE_ENV', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/Invalid NODE_ENV/);
  });

  it.each(['0', '-1', '65536', 'abc', '3.5'])('rejects the invalid PORT %s', (port) => {
    expect(() => loadConfig({ PORT: port })).toThrow(/Invalid PORT/);
  });
});
