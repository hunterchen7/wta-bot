import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { asUser, makeSigner, sendInteraction, type Signer } from './helpers';

let signer: Signer;
beforeAll(async () => {
  signer = await makeSigner();
});

describe('POST /discord', () => {
  it('503s when the public key is not configured', async () => {
    const res = await app.request(
      '/discord',
      { method: 'POST', body: JSON.stringify({ type: 1 }) },
      { ...env, DISCORD_PUBLIC_KEY: undefined },
    );
    expect(res.status).toBe(503);
  });

  it('401s on a missing signature', async () => {
    const res = await app.request(
      '/discord',
      { method: 'POST', body: JSON.stringify({ type: 1 }) },
      { ...env, DISCORD_PUBLIC_KEY: signer.publicKeyHex },
    );
    expect(res.status).toBe(401);
  });

  it('401s on a signature from the wrong key', async () => {
    const other = await makeSigner();
    const body = JSON.stringify({ type: 1 });
    const ts = '1720000000';
    const res = await app.request(
      '/discord',
      {
        method: 'POST',
        headers: {
          'x-signature-ed25519': await other.sign(ts, body),
          'x-signature-timestamp': ts,
        },
        body,
      },
      { ...env, DISCORD_PUBLIC_KEY: signer.publicKeyHex },
    );
    expect(res.status).toBe(401);
  });

  it('answers a valid PING with PONG', async () => {
    const res = await sendInteraction(signer, { type: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('answers unbuilt commands with the milestone stub', async () => {
    const res = await sendInteraction(signer, {
      type: 2,
      id: '1',
      token: 't',
      data: { name: 'report' },
      ...asUser('42'),
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { type: number; data: { content: string; flags: number } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(json.data.content).toContain('/report');
  });
});

describe('GET /health', () => {
  it('reports ok with an empty roster', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, participants: 0 });
  });
});
