import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { signFormToken } from '../src/forms/token';
import { app } from '../src/index';

describe('form rail', () => {
  it('404s an invalid token with a human page', async () => {
    const res = await app.request('/f/garbage-token', {}, env);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('invalid or expired');
  });

  it('accepts a valid token (M0 placeholder page)', async () => {
    const token = await signFormToken(
      env.FORM_SIGNING_SECRET!,
      42,
      new Date(Date.now() + 60_000),
    );
    const res = await app.request(`/f/${token}`, {}, env);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('instance #42');
  });

  it('503s when the signing secret is missing', async () => {
    const res = await app.request('/f/whatever', {}, { ...env, FORM_SIGNING_SECRET: undefined });
    expect(res.status).toBe(503);
  });
});
