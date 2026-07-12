import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '../src/forms/token';
import { app } from '../src/index';
import { hashLoginCode } from '../src/routes/web';

const STUDENT_ID = 40101;
const ADMIN_ID = 40102;
const cookieFor = async (participantId: number, organizer: boolean) => `wta_sess=${await signToken(env.FORM_SIGNING_SECRET!, `sess:${participantId}:${organizer ? 1 : 0}`, new Date(Date.now() + 3600_000))}`;
const jsonPost = (path: string, body: unknown, cookie?: string, overrides: Record<string, unknown> = {}) => app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) }, { ...env, ...overrides });

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (id, discord_id, discord_username, name, preferred_email, western_email, year, program, opportunities, experience_band, topics, blurb, status)
     VALUES (?1, '401', 'student.user', 'Stu Dent', 'stu@example.com', 'stu@uwo.ca', 'Third', 'Computer Science', '["internships"]', '1-2', '["dsa"]', ?3, 'active'),
            (?2, '402', 'organizer.user', 'Orga Nizer', 'org@example.com', 'org@uwo.ca', 'Fourth', 'Software Engineering', '["new_grad"]', '3-4', '["system_design"]', ?3, 'active')`,
  ).bind(STUDENT_ID, ADMIN_ID, 'I want to build useful developer infrastructure. '.repeat(25)).run();
});

describe('JSON authentication', () => {
  it('requests codes for roster emails and gives field guidance for unknown emails', async () => {
    const known = await jsonPost('/api/auth/request-code', { email: 'stu@example.com' });
    expect(known.status).toBe(200);
    expect(await known.json<any>()).toMatchObject({ ok: true, email: 'stu@example.com', expiresInMinutes: 10 });
    expect(await env.DB.prepare('SELECT id FROM login_codes WHERE participant_id = ?1').bind(STUDENT_ID).first()).not.toBeNull();

    const unknown = await jsonPost('/api/auth/request-code', { email: 'nobody@example.com' });
    expect(unknown.status).toBe(404);
    expect(await unknown.json<any>()).toMatchObject({ error: 'not_found', fieldErrors: { email: expect.any(String) } });
  });

  it('verifies a valid code, sets a session cookie, and counts invalid attempts', async () => {
    await env.DB.prepare('INSERT INTO login_codes (participant_id, code_hash, expires_at) VALUES (?1, ?2, ?3)')
      .bind(STUDENT_ID, await hashLoginCode(STUDENT_ID, '654321'), new Date(Date.now() + 600_000).toISOString()).run();
    const valid = await jsonPost('/api/auth/verify-code', { email: 'stu@example.com', code: '654321' });
    expect(valid.status).toBe(200);
    expect(await valid.json<any>()).toMatchObject({ ok: true, redirect: '/app' });
    expect(valid.headers.get('set-cookie')).toContain('wta_sess=');

    await env.DB.prepare('INSERT INTO login_codes (participant_id, code_hash, expires_at) VALUES (?1, ?2, ?3)')
      .bind(ADMIN_ID, await hashLoginCode(ADMIN_ID, '111111'), new Date(Date.now() + 600_000).toISOString()).run();
    const invalid = await jsonPost('/api/auth/verify-code', { email: 'org@example.com', code: '999999' });
    expect(invalid.status).toBe(400);
    expect(await invalid.json<any>()).toMatchObject({ fieldErrors: { code: expect.any(String) } });
    expect(await env.DB.prepare('SELECT attempts FROM login_codes WHERE participant_id = ?1 ORDER BY id DESC LIMIT 1').bind(ADMIN_ID).first()).toEqual({ attempts: 1 });
  });

  it('honors the organizer email whitelist and one-click magic links', async () => {
    await env.DB.prepare('INSERT INTO login_codes (participant_id, code_hash, expires_at) VALUES (?1, ?2, ?3)')
      .bind(STUDENT_ID, await hashLoginCode(STUDENT_ID, '222333'), new Date(Date.now() + 600_000).toISOString()).run();
    const login = await jsonPost('/api/auth/verify-code', { email: 'stu@example.com', code: '222333' }, undefined, { DASHBOARD_ADMINS: 'STU@example.com' });
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    expect((await app.request('/api/admin/overview', { headers: { Cookie: cookie } }, env)).status).toBe(200);

    const magic = await signToken(env.FORM_SIGNING_SECRET!, `magic:${STUDENT_ID}:0`, new Date(Date.now() + 60_000));
    const response = await app.request(`/auth/${magic}`, {}, env);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('/app');
  });
});

describe('participant dashboard API', () => {
  it('requires a session and exposes the Discord-to-dashboard identity mapping', async () => {
    expect((await app.request('/api/dashboard', {}, env)).status).toBe(401);
    const response = await app.request('/api/dashboard', { headers: { Cookie: await cookieFor(STUDENT_ID, false) } }, env);
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({
      participant: { name: 'Stu Dent', discordId: '401', discordUsername: 'student.user', preferredEmail: 'stu@example.com' },
      viewer: { participantId: STUDENT_ID, organizer: false },
    });
  });

  it('returns exact field errors and saves all participant settings together', async () => {
    const cookie = await cookieFor(STUDENT_ID, false);
    const invalid = await jsonPost('/api/settings', { name: '', preferredEmail: 'bad', westernEmail: '', year: '', program: '', experience: '', opportunities: [], topics: [], priorWta: false, emailOk: false, blurb: '', interests: '', priorFeedback: '' }, cookie);
    expect(invalid.status).toBe(400);
    const errors = (await invalid.json<any>()).fieldErrors;
    expect(errors).toMatchObject({ name: expect.any(String), preferredEmail: expect.any(String), opportunities: expect.any(String), topics: expect.any(String), blurb: expect.any(String) });

    const save = await jsonPost('/api/settings', { name: 'Student Updated', preferredEmail: 'student.updated@example.com', westernEmail: 'stu@uwo.ca', year: 'Fourth', program: 'Data Science', experience: '3-4', opportunities: ['internships', 'new_grad'], topics: ['dsa', 'practice'], priorWta: true, emailOk: true, blurb: 'I want to build reliable systems and learn how great engineering teams work. '.repeat(15), interests: 'Distributed systems', priorFeedback: 'More structured feedback' }, cookie);
    expect(save.status).toBe(200);
    expect(await env.DB.prepare('SELECT name, preferred_email, email_ok, discord_username FROM participants WHERE id = ?1').bind(STUDENT_ID).first()).toEqual({ name: 'Student Updated', preferred_email: 'student.updated@example.com', email_ok: 1, discord_username: 'student.user' });
    const confirmation = await env.DB.prepare("SELECT payload FROM outbox WHERE kind = 'email' AND payload LIKE '%subscribed%' ORDER BY id DESC LIMIT 1").first<any>();
    expect(JSON.parse(confirmation.payload).to).toBe('student.updated@example.com');
  });

  it('keeps legacy dashboard bookmarks as redirects only', async () => {
    const routes: Array<[string, string]> = [['/dashboard', '/app'], ['/dashboard/settings', '/app/settings'], ['/dashboard/roster', '/app/admin/participants'], ['/dashboard/week', '/app/admin/rounds']];
    for (const [path, destination] of routes) {
      const response = await app.request(path, {}, env);
      expect(response.status).toBe(308);
      expect(response.headers.get('location')).toBe(destination);
      expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
    }
  });
});
