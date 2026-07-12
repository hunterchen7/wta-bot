// Signed single-purpose form tokens (DESIGN.md §5).
// Format: <instanceId>.<expUnixSeconds>.<base64url(HMAC-SHA256(secret, "id.exp"))>
// The form_instances row remains the source of truth; the token only
// authenticates the bearer to one instance.

function b64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)));
}

export async function signFormToken(
  secret: string,
  instanceId: number,
  expiresAt: Date,
): Promise<string> {
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const sig = await hmac(secret, `${instanceId}.${exp}`);
  return `${instanceId}.${exp}.${sig}`;
}

export async function verifyFormToken(
  secret: string,
  token: string,
  now = new Date(),
): Promise<{ instanceId: number } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [idStr, expStr, sig] = parts as [string, string, string];
  const instanceId = Number(idStr);
  const exp = Number(expStr);
  if (!Number.isInteger(instanceId) || !Number.isInteger(exp)) return null;
  if (now.getTime() / 1000 > exp) return null;
  const expected = await hmac(secret, `${instanceId}.${exp}`);
  if (sig.length !== expected.length) return null;
  // Constant-time-ish comparison
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { instanceId } : null;
}
