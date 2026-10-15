import { describe, expect, test } from '@jest/globals';
import { cachedSigningKey } from '../app/session/signing-key';

/** How the session Lambda holds the session key it reads from Secrets Manager. */

const KEY = 'k'.repeat(64);

describe('cachedSigningKey', () => {
  test('reads the key once per execution environment, even for concurrent sign-ins', async () => {
    let reads = 0;
    const signingKey = cachedSigningKey('2', () => {
      reads += 1;
      return Promise.resolve(KEY);
    });

    const [first, second] = await Promise.all([signingKey(), signingKey()]);
    await signingKey();

    expect(first).toEqual({ kid: '2', secret: KEY });
    expect(second).toBe(first);
    expect(reads).toBe(1);
  });

  test('tries again after a failed read instead of failing until the environment is recycled', async () => {
    const outcomes = [
      () => Promise.reject(new Error('ThrottlingException')),
      () => Promise.resolve(KEY),
    ];
    let reads = 0;
    const signingKey = cachedSigningKey('2', () => outcomes[reads++]());

    await expect(signingKey()).rejects.toThrow('ThrottlingException');
    await expect(signingKey()).resolves.toEqual({ kid: '2', secret: KEY });
    expect(reads).toBe(2);
  });

  test.each([
    ['missing', undefined],
    ['empty', ''],
    ['shorter than 32 characters', 'k'.repeat(31)],
  ])('refuses a key that is %s', async (_label, value) => {
    const signingKey = cachedSigningKey('2', () => Promise.resolve(value));
    await expect(signingKey()).rejects.toThrow('missing or shorter than 32 characters');
  });
});
