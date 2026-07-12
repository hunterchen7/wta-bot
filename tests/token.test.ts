import { describe, expect, it } from 'vitest';
import { signFormToken, signToken, verifyFormToken, verifyToken } from '../src/forms/token';

const SECRET = 'test-signing-secret';
const future = new Date(Date.now() + 60_000);

describe('form tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await signFormToken(SECRET, 123, future);
    expect(await verifyFormToken(SECRET, token)).toEqual({ instanceId: 123 });
  });

  it('rejects an expired token', async () => {
    const past = new Date(Date.now() - 60_000);
    const token = await signFormToken(SECRET, 123, past);
    expect(await verifyFormToken(SECRET, token)).toBeNull();
  });

  it('rejects a tampered instance id', async () => {
    const token = await signFormToken(SECRET, 123, future);
    const [, exp, sig] = token.split('.');
    expect(await verifyFormToken(SECRET, `999.${exp}.${sig}`)).toBeNull();
  });

  it('rejects a tampered signature', async () => {
    const token = await signFormToken(SECRET, 123, future);
    const flipped = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
    expect(await verifyFormToken(SECRET, flipped)).toBeNull();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signFormToken('other-secret', 123, future);
    expect(await verifyFormToken(SECRET, token)).toBeNull();
  });

  it('rejects garbage', async () => {
    expect(await verifyFormToken(SECRET, 'not-a-token')).toBeNull();
    expect(await verifyFormToken(SECRET, 'a.b.c')).toBeNull();
    expect(await verifyFormToken(SECRET, '')).toBeNull();
  });

  it('supports namespaced subjects and enforces the no-dots rule', async () => {
    const token = await signToken(SECRET, 'export:participants', future);
    expect(await verifyToken(SECRET, token)).toEqual({ subject: 'export:participants' });
    await expect(signToken(SECRET, 'bad.subject', future)).rejects.toThrow();
  });

  it('form tokens do not verify as other subjects', async () => {
    const token = await signToken(SECRET, 'p:55', future);
    expect(await verifyFormToken(SECRET, token)).toBeNull();
  });
});
