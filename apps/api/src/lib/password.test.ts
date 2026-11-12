import { describe, expect, it } from '@jest/globals';

import { hashPassword, verifyPassword } from '../lib/password';

describe('password hashing', () => {
  it('verifies the original password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');

    await expect(verifyPassword(hash, 'correct-horse-battery-staple')).resolves.toBe(true);
  });

  it('rejects a different password', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');

    await expect(verifyPassword(hash, 'correct-horse-battery-stapl3')).resolves.toBe(false);
  });

  it('produces a different hash for the same password', async () => {
    const first = await hashPassword('correct-horse-battery-staple');
    const second = await hashPassword('correct-horse-battery-staple');

    expect(first).not.toBe(second);
  });

  it('uses Argon2id', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');

    expect(hash).toMatch(/^\$argon2id\$/);
  });

  it('returns false instead of throwing for a malformed hash', async () => {
    await expect(verifyPassword('not-a-hash', 'anything')).resolves.toBe(false);
  });
});
