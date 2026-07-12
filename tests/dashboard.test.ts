import { env } from 'cloudflare:workers';
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
  it('sends (or pretends to send) a code without leaking membership', async () => {
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
    expect(await fake.text()).toContain('Check your email');
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
    expect(html).not.toContain('href="/dashboard/roster"');

    const roster = await get('/dashboard/roster', cookie);
    expect(roster.status).toBe(403);
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
