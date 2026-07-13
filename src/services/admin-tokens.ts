import type { Env } from '../env';
import { isCurrentOrganizer } from '../organizers';

export const ADMIN_SCOPES = [
  'admin:read',
  'participants:write',
  'problems:write',
  'program:write',
  'operations:write',
] as const;

export type AdminScope = (typeof ADMIN_SCOPES)[number];
export type AdminPrincipal = {
  actorParticipantId: number;
  tokenId: number;
  tokenName: string;
  scopes: AdminScope[];
};

export const PERSONAL_MCP_TOKEN_NAME = 'Personal MCP access';
export const PERSONAL_MCP_TOKEN_SCOPES: AdminScope[] = [...ADMIN_SCOPES];

const encoder = new TextEncoder();

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  if (!env.FORM_SIGNING_SECRET) throw new Error('FORM_SIGNING_SECRET is required to protect admin tokens.');
  const material = await crypto.subtle.digest('SHA-256', encoder.encode(`wta-admin-token-v1:${env.FORM_SIGNING_SECRET}`));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function encryptAdminToken(env: Env, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode('wta-admin-token-v1') },
    await encryptionKey(env),
    encoder.encode(token),
  );
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(encrypted))}`;
}

export async function decryptAdminToken(env: Env, ciphertext: string): Promise<string> {
  const [version, encodedIv, encodedToken] = ciphertext.split('.');
  if (version !== 'v1' || !encodedIv || !encodedToken) throw new Error('Unsupported admin token ciphertext.');
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64url(encodedIv), additionalData: encoder.encode('wta-admin-token-v1') },
    await encryptionKey(env),
    fromBase64url(encodedToken),
  );
  return new TextDecoder().decode(decrypted);
}

export async function hashAdminToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeAdminScopes(value: unknown): AdminScope[] | null {
  if (!Array.isArray(value)) return null;
  const scopes = [...new Set(value.filter((scope): scope is AdminScope =>
    typeof scope === 'string' && ADMIN_SCOPES.includes(scope as AdminScope),
  ))];
  return scopes.length === value.length && scopes.includes('admin:read') ? scopes : null;
}

export async function createAdminToken(
  env: Env,
  actorParticipantId: number,
  name: string,
  scopes: AdminScope[],
  expiresAt: string | null,
  purpose = 'general',
): Promise<{ id: number; token: string; prefix: string }> {
  const secret = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const token = `wta_admin_${secret}`;
  const prefix = token.slice(0, 18);
  const result = await env.DB.prepare(
    `INSERT INTO admin_api_tokens
       (actor_participant_id, name, purpose, token_hash, token_ciphertext, token_prefix, scopes, expires_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(
    actorParticipantId,
    name.trim().slice(0, 80),
    purpose,
    await hashAdminToken(token),
    await encryptAdminToken(env, token),
    prefix,
    JSON.stringify(scopes),
    expiresAt,
  ).run();
  return { id: Number(result.meta.last_row_id), token, prefix };
}

export async function authenticateAdminBearer(env: Env, authorization: string | undefined): Promise<AdminPrincipal | null> {
  const match = /^Bearer\s+(wta_admin_[A-Za-z0-9_-]{40,})$/i.exec(authorization?.trim() ?? '');
  if (!match) return null;
  const now = new Date().toISOString();
  const row = await env.DB.prepare(
    `SELECT id, actor_participant_id, name, scopes
     FROM admin_api_tokens
     WHERE token_hash = ?1 AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?2)`,
  ).bind(await hashAdminToken(match[1]!), now).first<{
    id: number; actor_participant_id: number; name: string; scopes: string;
  }>();
  if (!row || !(await isCurrentOrganizer(env, row.actor_participant_id))) return null;
  let storedScopes: unknown = null;
  try { storedScopes = JSON.parse(row.scopes); } catch { storedScopes = null; }
  const scopes = normalizeAdminScopes(storedScopes) ?? [];
  if (!scopes.length) return null;
  const cutoff = new Date(Date.now() - 5 * 60_000).toISOString();
  await env.DB.prepare(
    `UPDATE admin_api_tokens SET last_used_at = ?2
     WHERE id = ?1 AND (last_used_at IS NULL OR last_used_at < ?3)`,
  ).bind(row.id, now, cutoff).run();
  return {
    actorParticipantId: row.actor_participant_id,
    tokenId: row.id,
    tokenName: row.name,
    scopes,
  };
}

export function hasAdminScope(principal: AdminPrincipal, scope: AdminScope): boolean {
  return principal.scopes.includes(scope);
}
