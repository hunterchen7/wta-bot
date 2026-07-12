import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { signToken } from '../src/forms/token';
import { app } from '../src/index';
import { hashLoginCode } from '../src/routes/web';

// Dashboard auth + views. Session cookies are forged with the test secret
// (same trust model as production: whoever signs, wins).

const cookieFor = async (participantId: number, organizer: boolean) => {
  const token = await signToken(
    env.FORM_SIGNING_SECRET!,
    `sess:${participantId}:${organizer ? 1 : 0}`,
    new Date(Date.now() + 3600_000),
  );
  return `wta_sess=${token}`;
};

const get = (path: string, cookie?: string) =>
  app.request(path, { headers: cookie ? { Cookie: cookie } : {} }, env);

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants (discord_id, name, preferred_email, topics, status) VALUES
     ('401', 'Stu Dent', 'stu@example.com', '["dsa"]', 'active'),
     ('402', 'Orga Nizer', 'org@example.com', '["dsa"]', 'active')`,
  ).run();
  await createCohort(env, 'Dash Test', [2026, 9, 14]);
});

describe('login flow', () => {
  it('sends a code to roster emails and bounces unknown ones with guidance', async () => {
    const real = await app.request(
      '/login',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=stu%40example.com' },
      env,
    );
    expect(real.status).toBe(200);
    expect(await real.text()).toContain('Check your email');
    const row = await env.DB.prepare('SELECT * FROM login_codes WHERE participant_id = 1').first();
    expect(row).not.toBeNull();

    const fake = await app.request(
      '/login',
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'email=nobody%40example.com' },
      env,
    );
    expect(fake.status).toBe(404);
    const html = await fake.text();
    expect(html).toContain("isn't on the roster");
    expect(html).toContain('/join');
    const codes = await env.DB.prepare('SELECT count(*) AS n FROM login_codes').first<{ n: number }>();
    expect(codes?.n).toBe(1); // no code row for the unknown email
  });

  it('logs in with a valid code and sets the session cookie', async () => {
    await env.DB.prepare(
      `INSERT INTO login_codes (participant_id, code_hash, expires_at) VALUES (1, ?1, ?2)`,
    )
      .bind(await hashLoginCode(1, '654321'), new Date(Date.now() + 600_000).toISOString())
      .run();
    const res = await app.request(
      '/login/code',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'email=stu%40example.com&code=654321',
      },
      env,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/dashboard');
    expect(res.headers.get('set-cookie')).toContain('wta_sess=');
  });

  it('rejects wrong codes and counts attempts', async () => {
    await env.DB.prepare(
      `INSERT INTO login_codes (participant_id, code_hash, expires_at) VALUES (2, ?1, ?2)`,
    )
      .bind(await hashLoginCode(2, '111111'), new Date(Date.now() + 600_000).toISOString())
      .run();
    const res = await app.request(
      '/login/code',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'email=org%40example.com&code=999999',
      },
      env,
    );
    expect(res.status).toBe(400);
    const row = await env.DB.prepare(
      'SELECT attempts FROM login_codes WHERE participant_id = 2 ORDER BY id DESC LIMIT 1',
    ).first<any>();
    expect(row.attempts).toBe(1);
  });
});

describe('admin whitelist', () => {
  it('grants organizer views to whitelisted emails at login', async () => {
    await env.DB.prepare(
      `INSERT INTO login_codes (participant_id, code_hash, expires_at) VALUES (1, ?1, ?2)`,
    )
      .bind(await hashLoginCode(1, '222333'), new Date(Date.now() + 600_000).toISOString())
      .run();
    const res = await app.request(
      '/login/code',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'email=stu%40example.com&code=222333',
      },
      { ...env, DASHBOARD_ADMINS: 'other@example.com, STU@example.com' },
    );
    expect(res.status).toBe(302);
    const cookie = res.headers.get('set-cookie')!.split(';')[0]!;
    const roster = await app.request('/dashboard/roster', { headers: { Cookie: cookie } }, env);
    expect(roster.status).toBe(200);
  });
});

describe('views + authorization', () => {
  it('redirects anonymous visitors to /login', async () => {
    const res = await get('/dashboard');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/login');
  });

  it('students see their progress, not organizer pages', async () => {
    const cookie = await cookieFor(1, false);
    const home = await get('/dashboard', cookie);
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain('Stu Dent');
    expect(html).toContain('Interviewer');
    expect(html).toContain('href="/dashboard/settings"');
    expect(html).toContain('href="/app/"');
    expect(html).not.toContain('href="/dashboard/roster"');

    const roster = await get('/dashboard/roster', cookie);
    expect(roster.status).toBe(403);
  });

  it('serves authenticated dashboard data through the JSON API', async () => {
    const denied = await app.request('/api/dashboard', {}, env);
    expect(denied.status).toBe(401);

    const response = await app.request(
      '/api/dashboard',
      { headers: { Cookie: await cookieFor(1, false) } },
      env,
    );
    expect(response.status).toBe(200);
    const payload = await response.json<any>();
    expect(payload.viewer).toEqual({ participantId: 1, organizer: false });
    expect(payload.participant).toMatchObject({ name: 'Stu Dent', preferredEmail: 'stu@example.com' });
    expect(payload.progress).toMatchObject({ interviewer: expect.any(Number), interviewee: expect.any(Number), strikes: expect.any(Number) });
    expect(payload.options.topics).toEqual(expect.arrayContaining([expect.objectContaining({ value: 'dsa' })]));
    expect(Array.isArray(payload.sessions)).toBe(true);
    expect(Array.isArray(payload.owedReports)).toBe(true);
  });

  it('shows email reminders as part of one save-all settings form', async () => {
    const cookie = await cookieFor(1, false);
    await env.DB.prepare('UPDATE participants SET email_ok = 0 WHERE id = 1').run();

    const settings = await get('/dashboard/settings', cookie);
    expect(settings.status).toBe(200);
    const html = await settings.text();
    expect(html).toContain('Email reminders');
    expect(html).toContain('type="checkbox" name="email_ok"');
    expect(html).toContain('action="/dashboard/settings/profile"');
    expect(html).toContain('Save all changes');
  });

  it('protects settings and rejects invalid profile values', async () => {
    const anonymous = await get('/dashboard/settings');
    expect(anonymous.status).toBe(302);
    expect(anonymous.headers.get('location')).toBe('/login');

    const invalid = await app.request(
      '/dashboard/settings/profile',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: await cookieFor(1, false),
        },
        body: '',
      },
      env,
    );
    expect(invalid.status).toBe(400);
  });

  it('lets participants update their own profile from settings', async () => {
    const cookie = await cookieFor(1, false);
    const body = new URLSearchParams({
      name: 'Student Updated',
      preferred_email: 'student.updated@example.com',
      western_email: 'supdated@uwo.ca',
      year: 'Fourth',
      program: 'Computer Science',
      experience_band: '3-4',
      prior_wta: '1',
      blurb: 'word '.repeat(170),
      interests: 'System design and networking',
      prior_feedback: 'More mock interviews',
      email_ok: '1',
    });
    body.append('opportunities', 'internships');
    body.append('opportunities', 'new_grad');
    body.append('topics', 'dsa');
    body.append('topics', 'system_design');

    const save = await app.request(
      '/dashboard/settings/profile',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: body.toString(),
      },
      env,
    );
    expect(save.status).toBe(302);
    expect(save.headers.get('location')).toBe('/dashboard/settings?saved=1');

    const participant = await env.DB.prepare('SELECT * FROM participants WHERE id = 1').first<any>();
    expect(participant).toMatchObject({
      name: 'Student Updated',
      preferred_email: 'student.updated@example.com',
      western_email: 'supdated@uwo.ca',
      year: 'Fourth',
      program: 'Computer Science',
      prior_wta: 1,
      experience_band: '3-4',
      interests: 'System design and networking',
      email_ok: 1,
    });
    expect(JSON.parse(participant.opportunities)).toEqual(['internships', 'new_grad']);
    expect(JSON.parse(participant.topics)).toEqual(['dsa', 'system_design']);
    const organizer = await env.DB.prepare('SELECT name, preferred_email FROM participants WHERE id = 2').first<any>();
    expect(organizer).toEqual({ name: 'Orga Nizer', preferred_email: 'org@example.com' });
    const nickname = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'nickname' ORDER BY id DESC LIMIT 1",
    ).first<any>();
    expect(JSON.parse(nickname.payload)).toMatchObject({ userId: '401', nick: 'Student Updated' });

    const confirmation = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'email' ORDER BY id DESC LIMIT 1",
    ).first<any>();
    expect(JSON.parse(confirmation.payload)).toMatchObject({
      to: 'student.updated@example.com',
      subject: "You're subscribed to WTA email reminders ✅",
    });

    // Unchecking only takes effect when the same save-all form is submitted.
    body.delete('email_ok');
    const disable = await app.request(
      '/dashboard/settings/profile',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: body.toString(),
      },
      env,
    );
    expect(disable.status).toBe(302);
    const disabled = await env.DB.prepare('SELECT email_ok FROM participants WHERE id = 1').first<any>();
    expect(disabled.email_ok).toBe(0);

    const apiSave = await app.request(
      '/api/settings',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({
          name: 'Student Updated',
          preferredEmail: 'student.updated@example.com',
          westernEmail: 'supdated@uwo.ca',
          year: 'Fourth',
          program: 'Computer Science',
          experience: '3-4',
          priorWta: true,
          emailOk: false,
          opportunities: ['internships', 'new_grad'],
          topics: ['dsa', 'system_design'],
          blurb: 'word '.repeat(170),
          interests: 'Saved through the React API',
          priorFeedback: 'More mock interviews',
        }),
      },
      env,
    );
    expect(apiSave.status).toBe(200);
    expect(await apiSave.json()).toEqual({ ok: true });
    expect((await env.DB.prepare('SELECT interests FROM participants WHERE id = 1').first<any>()).interests)
      .toBe('Saved through the React API');

    // Keep shared fixtures stable for the remaining dashboard tests.
    await env.DB.prepare(
      "UPDATE participants SET name = 'Stu Dent', preferred_email = 'stu@example.com' WHERE id = 1",
    ).run();
  });

  it('sends a newly opted-in confirmation without waiting for cron', async () => {
    await env.DB.prepare('UPDATE participants SET email_ok = 0 WHERE id = 1').run();
    const ctx = createExecutionContext();
    const response = await app.fetch(
      new Request('https://wta.test/api/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: await cookieFor(1, false),
        },
        body: JSON.stringify({
          name: 'Stu Dent',
          preferredEmail: 'stu@example.com',
          westernEmail: 'supdated@uwo.ca',
          year: 'Fourth',
          program: 'Computer Science',
          experience: '3-4',
          priorWta: true,
          emailOk: true,
          opportunities: ['internships', 'new_grad'],
          topics: ['dsa', 'system_design'],
          blurb: 'word '.repeat(170),
          interests: 'System design and networking',
          priorFeedback: 'More mock interviews',
        }),
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(200);
    await waitOnExecutionContext(ctx);

    const sent = await env.DB.prepare(
      `SELECT done_at, attempts FROM outbox
       WHERE kind = 'email' AND payload LIKE '%subscribed to WTA email reminders%'
       ORDER BY id DESC LIMIT 1`,
    ).first<{ done_at: string | null; attempts: number }>();
    expect(sent?.done_at).not.toBeNull();
    expect(sent?.attempts).toBe(0);
    await env.DB.prepare('UPDATE participants SET email_ok = 0 WHERE id = 1').run();
  });

  it('organizers get roster, week board, reviews, problems', async () => {
    const cookie = await cookieFor(2, true);
    for (const path of ['/dashboard/roster', '/dashboard/week', '/dashboard/reviews', '/dashboard/problems']) {
      const res = await get(path, cookie);
      expect(res.status, path).toBe(200);
    }
    const roster = await (await get('/dashboard/roster', cookie)).text();
    expect(roster).toContain('Stu Dent');
    expect(roster).toContain('org@example.com');
  });

  it('profile pages show intake, sessions, artifacts, and partner links', async () => {
    const cookie = await cookieFor(2, true);
    const week1 = await env.DB.prepare('SELECT id FROM weeks WHERE idx = 1').first<any>();
    const ins = await env.DB.prepare(
      `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, scheduled_at, interviewee_credited)
       VALUES (?1, 2, 1, 'completed', '2026-09-16T23:30:00.000Z', 1)`,
    )
      .bind(week1.id)
      .run();
    const sid = Number(ins.meta.last_row_id);
    await env.DB.prepare(
      `INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at, submitted_at, payload)
       VALUES ('interviewee_report', ?1, 1, ?2, '2026-09-21T03:59:00.000Z', '2026-09-17T00:00:00.000Z', ?3)`,
    )
      .bind(
        sid,
        crypto.randomUUID(),
        JSON.stringify({ video_url: 'https://rec.example/xyz', code: 'print(42)', rating_experience: '5' }),
      )
      .run();
    await env.DB.prepare(
      `INSERT INTO form_instances (kind, session_id, assignee_id, token_hash, deadline_at, submitted_at, payload)
       VALUES ('interviewer_report', ?1, 2, ?2, '2026-09-21T03:59:00.000Z', '2026-09-17T00:00:00.000Z', ?3)`,
    )
      .bind(sid, crypto.randomUUID(), JSON.stringify({ verdict: 'pass', hints: 'few', rating_problem_solving: '4' }))
      .run();

    const res = await get('/dashboard/p/1', cookie);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Stu Dent');
    expect(html).toContain('dsa'); // intake topics render
    expect(html).toContain('https://rec.example/xyz'); // recording link
    expect(html).toContain('print(42)'); // code artifact
    expect(html).toContain('pass'); // interviewer verdict
    expect(html).toContain('/dashboard/p/2'); // partner link

    // students cannot view profiles
    const stu = await get('/dashboard/p/2', await cookieFor(1, false));
    expect(stu.status).toBe(403);

    // roster links through to profiles
    const roster = await (await get('/dashboard/roster', cookie)).text();
    expect(roster).toContain('/dashboard/p/1');
  });

  it('review verify action updates state and problem editor saves content', async () => {
    const cookie = await cookieFor(2, true);
    // seed a pending-review session
    const week3 = await env.DB.prepare('SELECT id FROM weeks WHERE idx = 3').first<any>();
    const ins = await env.DB.prepare(
      `INSERT INTO sessions (week_id, interviewer_id, interviewee_id, state, review_state)
       VALUES (?1, 2, 1, 'completed', 'pending')`,
    )
      .bind(week3.id)
      .run();
    const sid = Number(ins.meta.last_row_id);

    const res = await app.request(
      `/dashboard/reviews/${sid}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: 'action=verify',
      },
      env,
    );
    expect(res.status).toBe(302);
    const s = await env.DB.prepare('SELECT review_state FROM sessions WHERE id = ?1').bind(sid).first<any>();
    expect(s.review_state).toBe('verified');

    // problem editor
    await env.DB.prepare("INSERT INTO problems (title, difficulty) VALUES ('Editable', 'easy')").run();
    const pid = (await env.DB.prepare("SELECT id FROM problems WHERE title = 'Editable'").first<any>()).id;
    const save = await app.request(
      `/dashboard/problems/${pid}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookie },
        body: 'statement_md=Given+an+array...&solution_md=Use+a+hashmap.&hints_md=Think+lookup.',
      },
      env,
    );
    expect(save.status).toBe(302);
    const p = await env.DB.prepare('SELECT * FROM problems WHERE id = ?1').bind(pid).first<any>();
    expect(p.solution_md).toBe('Use a hashmap.');

    // students cannot hit review actions
    const stuCookie = await cookieFor(1, false);
    const denied = await app.request(
      `/dashboard/reviews/${sid}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: stuCookie },
        body: 'action=flag',
      },
      env,
    );
    expect(denied.status).toBe(403);
  });
});
