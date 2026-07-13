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
    `INSERT INTO participants (id, discord_id, discord_username, discord_nickname, name, preferred_email, western_email, year, program, opportunities, experience_band, topics, blurb, status)
     VALUES (?1, '401', 'student.user', 'Stu Nick', 'Stu Dent', 'stu@example.com', 'stu@uwo.ca', 'Third', 'Computer Science', '["internships"]', '1-2', '["dsa"]', ?3, 'active'),
            (?2, '402', 'organizer.user', 'Organizer Nick', 'Orga Nizer', 'org@example.com', 'org@uwo.ca', 'Fourth', 'Software Engineering', '["new_grad"]', '3-4', '["system_design"]', ?3, 'active')`,
  ).bind(STUDENT_ID, ADMIN_ID, 'I want to build useful developer infrastructure. '.repeat(25)).run();
});

describe('JSON authentication', () => {
  it('reports whether the current browser session is authenticated', async () => {
    const anonymous = await app.request('/api/auth/session', {}, env);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json<any>()).toEqual({ authenticated: false });

    const authenticated = await app.request('/api/auth/session', {
      headers: { Cookie: await cookieFor(STUDENT_ID, false) },
    }, env);
    expect(authenticated.status).toBe(200);
    expect(await authenticated.json<any>()).toEqual({ authenticated: true, organizer: false, redirect: '/app' });
  });

  it('gates preview page assets to organizer sessions', async () => {
    const previewEnv = { ...env, ASSETS: { fetch: async () => new Response('preview shell', { headers: { 'Content-Type': 'text/html' } }) } };
    const anonymous = await app.request('/preview/form/interviewee_report?embed=1', {}, previewEnv);
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get('location')).toBe('/login?next=%2Fpreview%2Fform%2Finterviewee_report%3Fembed%3D1');

    const participant = await app.request('/preview', { headers: { Cookie: await cookieFor(STUDENT_ID, false) } }, previewEnv);
    expect(participant.status).toBe(302);
    expect(participant.headers.get('location')).toBe('/app');

    const organizer = await app.request('/preview', { headers: { Cookie: await cookieFor(ADMIN_ID, true) } }, previewEnv);
    expect(organizer.status).toBe(200);
    expect(await organizer.text()).toBe('preview shell');
  });

  it('requests codes without disclosing whether an email is on the roster', async () => {
    const known = await jsonPost('/api/auth/request-code', { email: 'stu@example.com' });
    expect(known.status).toBe(200);
    expect(await known.json<any>()).toMatchObject({ ok: true, email: 'stu@example.com', expiresInMinutes: 10 });
    expect(await env.DB.prepare('SELECT id FROM login_codes WHERE participant_id = ?1').bind(STUDENT_ID).first()).not.toBeNull();

    const unknown = await jsonPost('/api/auth/request-code', { email: 'nobody@example.com' });
    expect(unknown.status).toBe(200);
    expect(await unknown.json<any>()).toMatchObject({ ok: true, email: 'nobody@example.com', expiresInMinutes: 10 });
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
    expect((await app.request('/api/admin/overview', { headers: { Cookie: cookie } }, { ...env, DASHBOARD_ADMINS: 'stu@example.com' })).status).toBe(200);

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
      participant: { name: 'Stu Dent', discordId: '401', discordUsername: 'student.user', discordNickname: 'Stu Nick', preferredEmail: 'stu@example.com' },
      viewer: { participantId: STUDENT_ID, organizer: false },
      minimumBlurbWords: 100,
    });
  });

  it('reports personal submission while the session still waits for the partner', async () => {
    const past = new Date(Date.now() - 60 * 60_000).toISOString();
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    await env.DB.prepare("INSERT INTO cohorts (id, name, start_date, weeks_count, status) VALUES (40110, 'Dashboard status', '2026-07-26', 3, 'done')").run();
    await env.DB.prepare(
      `INSERT INTO weeks (id, cohort_id, idx, optin_opens_at, optin_closes_at, match_at, reports_due_at)
       VALUES (40111, 40110, 1, '2026-07-19T20:00:00.000Z', '2026-07-26T23:00:00.000Z', '2026-07-26T23:15:00.000Z', '2026-08-09T03:59:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO sessions (id, week_id, interviewer_id, interviewee_id, state, scheduled_at)
       VALUES
         (40112, 40111, ?1, ?2, 'scheduled', ?3),
         (40115, 40111, ?1, ?2, 'scheduled', ?3),
         (40118, 40111, ?1, ?2, 'scheduled', ?3),
         (40121, 40111, ?1, ?2, 'scheduled', ?3),
         (40124, 40111, ?1, ?2, 'scheduled', ?4)`,
    ).bind(STUDENT_ID, ADMIN_ID, past, future).run();
    await env.DB.prepare(
      `INSERT INTO form_instances (id, kind, session_id, assignee_id, token_hash, deadline_at, submitted_at, payload)
       VALUES
         (40113, 'interviewer_report', 40112, ?1, 'dashboard-status-own', '2026-08-09T03:59:00.000Z', ?3, '{}'),
         (40114, 'interviewee_report', 40112, ?2, 'dashboard-status-partner', '2026-08-09T03:59:00.000Z', NULL, NULL),
         (40116, 'interviewer_report', 40115, ?1, 'dashboard-status-own-needed', '2026-08-09T03:59:00.000Z', NULL, NULL),
         (40117, 'interviewee_report', 40115, ?2, 'dashboard-status-partner-done', '2026-08-09T03:59:00.000Z', ?3, '{}'),
         (40119, 'interviewer_report', 40118, ?1, 'dashboard-status-own-waiting', '2026-08-09T03:59:00.000Z', NULL, NULL),
         (40120, 'interviewee_report', 40118, ?2, 'dashboard-status-partner-waiting', '2026-08-09T03:59:00.000Z', NULL, NULL),
         (40122, 'interviewer_report', 40121, ?1, 'dashboard-status-own-done', '2026-08-09T03:59:00.000Z', ?3, '{}'),
         (40123, 'interviewee_report', 40121, ?2, 'dashboard-status-both-done', '2026-08-09T03:59:00.000Z', ?3, '{}')`,
    ).bind(STUDENT_ID, ADMIN_ID, past).run();

    const response = await app.request('/api/dashboard', { headers: { Cookie: await cookieFor(STUDENT_ID, false) } }, env);
    const dashboard = await response.json<any>();
    expect(Object.fromEntries(dashboard.sessions.filter((row: any) => row.id >= 40112).map((row: any) => [row.id, row.reportState]))).toEqual({
      40112: 'waiting_partner',
      40115: 'waiting_you',
      40118: 'waiting_both',
      40121: 'complete',
      40124: 'not_released',
    });
  });

  it('returns exact field errors and saves all participant settings together', async () => {
    const cookie = await cookieFor(STUDENT_ID, false);
    const invalid = await jsonPost('/api/settings', { name: '', preferredEmail: 'bad', westernEmail: '', year: '', program: '', experience: '', opportunities: [], topics: [], priorWta: false, emailOk: false, blurb: '', interests: '', priorFeedback: '' }, cookie);
    expect(invalid.status).toBe(400);
    const errors = (await invalid.json<any>()).fieldErrors;
    expect(errors).toMatchObject({ name: expect.any(String), preferredEmail: expect.any(String), opportunities: expect.any(String), topics: expect.any(String), blurb: expect.any(String) });
    expect(errors.blurb).toContain('currently 0');

    const save = await jsonPost('/api/settings', { name: 'Student Updated', preferredEmail: 'student.updated@example.com', westernEmail: 'stu@uwo.ca', year: 'Fourth', program: 'Data Science', experience: '3-4', opportunities: ['internships', 'new_grad'], topics: ['dsa', 'practice'], priorWta: true, emailOk: true, blurb: 'I want to build reliable systems and learn how great engineering teams work. '.repeat(15), interests: 'Distributed systems', priorFeedback: 'More structured feedback' }, cookie);
    expect(save.status).toBe(200);
    expect(await env.DB.prepare('SELECT name, preferred_email, email_ok, discord_username, discord_nickname FROM participants WHERE id = ?1').bind(STUDENT_ID).first()).toEqual({ name: 'Student Updated', preferred_email: 'student.updated@example.com', email_ok: 1, discord_username: 'student.user', discord_nickname: 'Student' });
    const nickname = await env.DB.prepare("SELECT payload FROM outbox WHERE kind = 'nickname' AND json_extract(payload, '$.userId') = '401' ORDER BY id DESC LIMIT 1").first<{ payload: string }>();
    expect(JSON.parse(nickname!.payload)).toMatchObject({ nick: 'Student' });
    const confirmation = await env.DB.prepare("SELECT payload FROM outbox WHERE kind = 'email' AND payload LIKE '%subscribed%' ORDER BY id DESC LIMIT 1").first<any>();
    expect(JSON.parse(confirmation.payload).to).toBe('student.updated@example.com');
  });

  it('does not try to manage an organizer’s Discord nickname', async () => {
    const before = await env.DB.prepare("SELECT count(*) AS n FROM outbox WHERE kind = 'nickname' AND json_extract(payload, '$.userId') = '402'").first<{ n: number }>();
    const save = await jsonPost('/api/settings', {
      name: 'Organizer Updated', preferredEmail: 'org@example.com', westernEmail: 'org@uwo.ca', year: 'Fourth', program: 'Software Engineering', experience: '3-4',
      opportunities: ['new_grad'], topics: ['system_design'], priorWta: false, emailOk: false,
      blurb: 'I want to help participants practice realistic interviews and give precise feedback that makes each round more useful. '.repeat(12), interests: '', priorFeedback: '',
    }, await cookieFor(ADMIN_ID, true), { DASHBOARD_ADMINS: 'org@example.com' });
    expect(save.status).toBe(200);
    const after = await env.DB.prepare("SELECT count(*) AS n FROM outbox WHERE kind = 'nickname' AND json_extract(payload, '$.userId') = '402'").first<{ n: number }>();
    expect(after?.n).toBe(before?.n);
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
