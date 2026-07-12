import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { app } from '../src/index';

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function makeSigner() {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKeyHex = bytesToHex(
    (await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer,
  );
  const sign = async (timestamp: string, body: string) =>
    bytesToHex(
      await crypto.subtle.sign('Ed25519', keys.privateKey, new TextEncoder().encode(timestamp + body)),
    );
  return { publicKeyHex, sign };
}

function post(body: string, headers: Record<string, string>, publicKey?: string) {
  return app.request(
    '/discord',
    { method: 'POST', headers, body },
    { ...env, DISCORD_PUBLIC_KEY: publicKey },
  );
}

describe('POST /discord', () => {
  it('503s when the public key is not configured', async () => {
    const res = await post(JSON.stringify({ type: 1 }), {});
    expect(res.status).toBe(503);
  });

  it('401s on a missing signature', async () => {
    const { publicKeyHex } = await makeSigner();
    const res = await post(JSON.stringify({ type: 1 }), {}, publicKeyHex);
    expect(res.status).toBe(401);
  });

  it('401s on a bad signature', async () => {
    const { publicKeyHex } = await makeSigner();
    const other = await makeSigner(); // signs with a different key
    const body = JSON.stringify({ type: 1 });
    const ts = '1720000000';
    const res = await post(
      body,
      { 'x-signature-ed25519': await other.sign(ts, body), 'x-signature-timestamp': ts },
      publicKeyHex,
    );
    expect(res.status).toBe(401);
  });

  it('answers a valid PING with PONG', async () => {
    const { publicKeyHex, sign } = await makeSigner();
    const body = JSON.stringify({ type: 1 });
    const ts = '1720000000';
    const res = await post(
      body,
      { 'x-signature-ed25519': await sign(ts, body), 'x-signature-timestamp': ts },
      publicKeyHex,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ type: 1 });
  });

  it('answers a slash command with the ephemeral M0 stub', async () => {
    const { publicKeyHex, sign } = await makeSigner();
    const body = JSON.stringify({ type: 2, data: { name: 'status' } });
    const ts = '1720000000';
    const res = await post(
      body,
      { 'x-signature-ed25519': await sign(ts, body), 'x-signature-timestamp': ts },
      publicKeyHex,
    );
    expect(res.status).toBe(200);
    const json = (await res.json()) as { type: number; data: { content: string; flags: number } };
    expect(json.type).toBe(4);
    expect(json.data.flags).toBe(64);
    expect(json.data.content).toContain('/status');
  });
});

describe('GET /health', () => {
  it('reports ok with an empty roster', async () => {
    const res = await app.request('/health', {}, env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, participants: 0 });
  });
});
