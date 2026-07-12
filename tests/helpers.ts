// Shared test utilities: a real Ed25519 signer + request builder so tests hit
// the interactions endpoint exactly like Discord does.

import { env } from 'cloudflare:workers';
import { app } from '../src/index';

function bytesToHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function makeSigner() {
  const keys = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  const publicKeyHex = bytesToHex(
    (await crypto.subtle.exportKey('raw', keys.publicKey)) as ArrayBuffer,
  );
  const sign = async (timestamp: string, body: string) =>
    bytesToHex(
      await crypto.subtle.sign(
        'Ed25519',
        keys.privateKey,
        new TextEncoder().encode(timestamp + body),
      ),
    );
  return { publicKeyHex, sign };
}

export type Signer = Awaited<ReturnType<typeof makeSigner>>;

/** POSTs a signed interaction to /discord with the signer's key configured. */
export async function sendInteraction(signer: Signer, interaction: unknown) {
  const body = JSON.stringify(interaction);
  const ts = '1720000000';
  return app.request(
    '/discord',
    {
      method: 'POST',
      headers: {
        'x-signature-ed25519': await signer.sign(ts, body),
        'x-signature-timestamp': ts,
      },
      body,
    },
    { ...env, DISCORD_PUBLIC_KEY: signer.publicKeyHex },
  );
}

export const asUser = (id: string, extra: Record<string, unknown> = {}) => ({
  member: { user: { id, username: `user-${id}` }, permissions: '0', ...extra },
});

export const asAdmin = (id: string) => asUser(id, { permissions: String(1 << 3) });
