import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { getSetting } from '../config';
import { DiscordRest } from '../discord/rest';
import { sendEmail } from '../email';
import type { Env } from '../env';
import { signToken, verifyToken } from '../forms/token';

// Authentication is the only browser concern that still needs a Worker route:
// everything visible is rendered by the React app, while this module owns OTPs
// and the HttpOnly session cookie.
export const web = new Hono<{ Bindings: Env }>();

const COOKIE = 'wta_sess';
const CODE_TTL_MIN = 10;
const SESSION_DAYS = 7;

export async function hashLoginCode(participantId: number, code: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${participantId}:${code}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type SessionUser = { participantId: number; organizer: boolean };

export async function sessionFrom(c: any): Promise<SessionUser | null> {
  const secret = c.env.FORM_SIGNING_SECRET;
  const raw = getCookie(c, COOKIE);
  if (!secret || !raw) return null;
  const verified = await verifyToken(secret, raw);
  const match = verified && /^sess:(\d+):([01])$/.exec(verified.subject);
  if (!match) return null;
  return { participantId: Number(match[1]), organizer: match[2] === '1' };
}

web.get('/api/auth/session', async (c) => {
  const session = await sessionFrom(c);
  if (!session) return c.json({ authenticated: false }, 401);
  const participant = await c.env.DB.prepare('SELECT id FROM participants WHERE id = ?1')
    .bind(session.participantId)
    .first<{ id: number }>();
  if (!participant) return c.json({ authenticated: false }, 401);
  return c.json({ authenticated: true, organizer: session.organizer, redirect: '/app' });
});

web.post('/api/auth/request-code', async (c) => {
  const body = await c.req.json<{ email?: string }>().catch(() => null);
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    return c.json({ error: 'invalid_email', message: 'Enter a valid email address.', fieldErrors: { email: 'Enter a valid email address.' } }, 400);
  }
  const participant = await c.env.DB.prepare(
    'SELECT id, preferred_email, name FROM participants WHERE lower(preferred_email) = ?1',
  ).bind(email).first<{ id: number; preferred_email: string; name: string | null }>();
  if (!participant) {
    return c.json({ error: 'not_found', message: 'That email is not on the WTA roster.', fieldErrors: { email: 'Use the email from your WTA enrollment.' } }, 404);
  }

  const recent = await c.env.DB.prepare(
    'SELECT count(*) AS n FROM login_codes WHERE participant_id = ?1 AND created_at > ?2',
  ).bind(participant.id, new Date(Date.now() - 15 * 60_000).toISOString()).first<{ n: number }>();
  if ((recent?.n ?? 0) < 3) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await c.env.DB.prepare(
      'INSERT INTO login_codes (participant_id, code_hash, expires_at) VALUES (?1, ?2, ?3)',
    ).bind(
      participant.id,
      await hashLoginCode(participant.id, code),
      new Date(Date.now() + CODE_TTL_MIN * 60_000).toISOString(),
    ).run();
    await sendEmail(
      c.env,
      participant.preferred_email,
      `${code} is your WTA dashboard code`,
      `Hi ${participant.name ?? 'there'},\n\nYour WTA dashboard login code is: ${code}\nIt expires in ${CODE_TTL_MIN} minutes. If you didn't request this, ignore it.\n\n— Western Tech Alumni`,
    ).catch((error) => console.error('otp send failed:', error));
  }
  return c.json({ ok: true, email, expiresInMinutes: CODE_TTL_MIN });
});

web.post('/api/auth/verify-code', async (c) => {
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.json({ error: 'not_configured', message: 'Sign-in is not configured.' }, 503);
  const body = await c.req.json<{ email?: string; code?: string }>().catch(() => null);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const code = String(body?.code ?? '').trim();
  const participant = await c.env.DB.prepare(
    'SELECT id, discord_id FROM participants WHERE lower(preferred_email) = ?1',
  ).bind(email).first<{ id: number; discord_id: string }>();
  if (!participant || !/^\d{6}$/.test(code)) return invalidCode(c);

  const row = await c.env.DB.prepare(
    `SELECT id, code_hash, attempts FROM login_codes
     WHERE participant_id = ?1 AND used_at IS NULL AND expires_at > ?2
     ORDER BY id DESC LIMIT 1`,
  ).bind(participant.id, new Date().toISOString()).first<{ id: number; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= 5) return invalidCode(c);
  if (row.code_hash !== await hashLoginCode(participant.id, code)) {
    await c.env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?1').bind(row.id).run();
    return invalidCode(c);
  }
  await c.env.DB.prepare('UPDATE login_codes SET used_at = ?2 WHERE id = ?1').bind(row.id, new Date().toISOString()).run();
  const organizer = isWhitelistedAdmin(c.env, email) || await checkOrganizer(c.env, participant.discord_id);
  await setSessionCookie(c, participant.id, organizer);
  return c.json({ ok: true, redirect: '/app' });
});

web.get('/auth/:token', async (c) => {
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.redirect('/login?error=not-configured');
  const verified = await verifyToken(secret, c.req.param('token'));
  const match = verified && /^magic:(\d+):([01])$/.exec(verified.subject);
  if (!match) return c.redirect('/login?error=expired');
  await setSessionCookie(c, Number(match[1]), match[2] === '1');
  return c.redirect('/app');
});

web.post('/logout', (c) => {
  setCookie(c, COOKIE, '', { httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: 0 });
  return c.json({ ok: true, redirect: '/login' });
});

// Keep old bookmarks useful without retaining any of the legacy HTML surface.
web.get('/dashboard', (c) => c.redirect('/app', 308));
web.get('/dashboard/settings', (c) => c.redirect('/app/settings', 308));
web.get('/dashboard/roster', (c) => c.redirect('/app/admin/participants', 308));
web.get('/dashboard/p/:id', (c) => c.redirect(`/app/admin/participants?id=${c.req.param('id')}`, 308));
web.get('/dashboard/week', (c) => c.redirect('/app/admin/rounds', 308));
web.get('/dashboard/reviews', (c) => c.redirect('/app/admin/reviews', 308));
web.get('/dashboard/problems', (c) => c.redirect('/app/admin/problems', 308));

function invalidCode(c: any) {
  return c.json({ error: 'invalid_code', message: 'That code is invalid or expired.', fieldErrors: { code: 'Request a fresh code and try again.' } }, 400);
}

async function setSessionCookie(c: any, participantId: number, organizer: boolean) {
  const token = await signToken(
    c.env.FORM_SIGNING_SECRET,
    `sess:${participantId}:${organizer ? 1 : 0}`,
    new Date(Date.now() + SESSION_DAYS * 86400_000),
  );
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

export function isWhitelistedAdmin(env: Env, email: string): boolean {
  return (env.DASHBOARD_ADMINS ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean).includes(email.toLowerCase());
}

async function checkOrganizer(env: Env, discordId: string): Promise<boolean> {
  const roleId = await getSetting(env, 'organizer_role_id');
  const guildId = env.ALLOWED_GUILD_IDS?.split(',')[0]?.trim();
  if (!roleId || !guildId || !env.DISCORD_TOKEN) return false;
  try {
    const member = await new DiscordRest(env.DISCORD_TOKEN).getGuildMember(guildId, discordId);
    return member.roles.includes(roleId);
  } catch {
    return false;
  }
}
