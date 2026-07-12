// Signed single-purpose tokens (DESIGN.md §5).
// Format: <subject>.<expUnixSeconds>.<base64url(HMAC-SHA256(secret, "subject.exp"))>
// Subjects are namespaced strings, e.g. "f:123" (form instance), "export:all",
// "p:456" (interviewer packet). The DB row behind the subject remains the
// source of truth; the token only authenticates the bearer to one subject.

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

/** Subject must not contain "." — dots delimit token parts. */
export async function signToken(secret: string, subject: string, expiresAt: Date): Promise<string> {
  if (subject.includes('.')) throw new Error('token subject must not contain "."');
  const exp = Math.floor(expiresAt.getTime() / 1000);
  const sig = await hmac(secret, `${subject}.${exp}`);
  return `${subject}.${exp}.${sig}`;
}

export async function verifyToken(
  secret: string,
  token: string,
  now = new Date(),
): Promise<{ subject: string } | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [subject, expStr, sig] = parts as [string, string, string];
  const exp = Number(expStr);
  if (!subject || !Number.isInteger(exp)) return null;
  if (now.getTime() / 1000 > exp) return null;
  const expected = await hmac(secret, `${subject}.${exp}`);
  if (sig.length !== expected.length) return null;
  // Constant-time-ish comparison
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? { subject } : null;
}

// Convenience wrappers for form-instance tokens (subject "f:<id>")
export async function signFormToken(secret: string, instanceId: number, expiresAt: Date) {
  return signToken(secret, `f:${instanceId}`, expiresAt);
}

export async function verifyFormToken(secret: string, token: string, now = new Date()) {
  const result = await verifyToken(secret, token, now);
  if (!result) return null;
  const match = /^f:(\d+)$/.exec(result.subject);
  return match ? { instanceId: Number(match[1]) } : null;
}
