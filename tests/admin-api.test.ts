import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createCohort } from '../src/engine/weeks';
import { signToken } from '../src/forms/token';
import { app } from '../src/index';

const ADMIN_ID = 9101;
const STUDENT_ID = 9102;
let weekId = 0;
let futureWeekId = 0;

const cookieFor = async (participantId: number, organizer: boolean) => {
  const token = await signToken(
    env.FORM_SIGNING_SECRET!,
    `sess:${participantId}:${organizer ? 1 : 0}`,
    new Date(Date.now() + 3600_000),
  );
  return `wta_sess=${token}`;
};

const request = async (path: string, options: RequestInit = {}, organizer = true) =>
  app.request(path, {
    ...options,
    headers: {
      Cookie: await cookieFor(organizer ? ADMIN_ID : STUDENT_ID, organizer),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  }, env);

beforeAll(async () => {
  await env.DB.prepare(
    `INSERT INTO participants
      (id, discord_id, discord_username, discord_nickname, name, preferred_email, western_email, year, program, topics, email_ok, status)
     VALUES
      (?1, 'admin-9101', 'admin.account', 'Admin Nick', 'Admin Person', 'admin@example.com', 'admin@uwo.ca', 'Fourth', 'Computer Science', '["dsa"]', 1, 'active'),
      (?2, 'student-9102', 'student.account', 'Student Nick', 'Student Person', 'student@example.com', 'student@uwo.ca', 'Third', 'Software Engineering', '["dsa"]', 1, 'active')`,
  ).bind(ADMIN_ID, STUDENT_ID).run();
  const cohort = await createCohort(env, 'Admin API Cohort', [2026, 7, 26]);
  weekId = cohort.weeks[0]!.id;
  futureWeekId = cohort.weeks[1]!.id;
  await env.DB.prepare(
    `INSERT INTO problems (id, title, difficulty, difficulty_rank) VALUES (9301, 'Two Sum', 'easy', 1.0)`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO sessions (id, week_id, interviewer_id, interviewee_id, state, problem_id, review_state)
     VALUES (9201, ?1, ?2, ?3, 'completed', 9301, 'pending')`,
  ).bind(weekId, ADMIN_ID, STUDENT_ID).run();
  await env.DB.prepare(
    `INSERT INTO form_instances (id, kind, session_id, assignee_id, token_hash, deadline_at, submitted_at, payload)
     VALUES
       (9401, 'interviewee_report', 9201, ?1, 'admin-api-ie', ?2, ?3, '{"video_url":"https://example.com/video","rating_experience":"4"}'),
       (9402, 'interviewer_report', 9201, ?4, 'admin-api-ir', ?2, ?3, '{"verdict":"pass","verdict_reason":"Strong fundamentals"}')`,
  ).bind(STUDENT_ID, new Date(Date.now() + 86400_000).toISOString(), new Date().toISOString(), ADMIN_ID).run();
});

describe('admin JSON API authorization', () => {
  it('rejects anonymous and participant sessions', async () => {
    expect((await app.request('/api/admin/overview', {}, env)).status).toBe(401);
    expect((await request('/api/admin/overview', {}, false)).status).toBe(403);
  });
});

describe('admin operational data', () => {
  it('returns overview queues and matching readiness', async () => {
    const response = await request('/api/admin/overview');
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    expect(body.cohort.name).toBe('Admin API Cohort');
    expect(body.activeParticipants).toBe(2);
    expect(body.matchingReady).toBe(false);
    expect(body.queues).toMatchObject({ reviews: 1, failedOutbox: 0 });
  });

  it('returns roster, detail, rounds, analytics, and CSV', async () => {
    const roster = await (await request('/api/admin/participants')).json<any>();
    expect(roster.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: STUDENT_ID,
        name: 'Student Person',
        discord_username: 'student.account',
        discord_nickname: 'Student Nick',
        discord_id: 'student-9102',
        email_ok: 1,
      }),
    ]));

    const detail = await (await request(`/api/admin/participants/${STUDENT_ID}`)).json<any>();
    expect(detail.participant.name).toBe('Student Person');
    expect(detail.sessions[0]).toMatchObject({ id: 9201, problem_title: 'Two Sum' });

    const rounds = await (await request(`/api/admin/rounds?week=${weekId}`)).json<any>();
    expect(rounds.sessions[0]).toMatchObject({ id: 9201, interviewer_name: 'Admin Person' });
    expect(rounds.selectedWeek.id).toBe(weekId);

    await env.DB.prepare(
      `INSERT INTO optins (week_id, participant_id) VALUES (?1, ?2), (?1, ?3)`,
    ).bind(weekId, ADMIN_ID, STUDENT_ID).run();
    const analytics = await (await request('/api/admin/analytics')).json<any>();
    expect(analytics.verdicts).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'pass' })]));
    expect(analytics.problems[0]).toMatchObject({ title: 'Two Sum', uses: 1 });
    expect(analytics.rounds).toEqual(expect.arrayContaining([
      expect.objectContaining({ round: 1, optins: 2, sessions: 1, completed: 1 }),
    ]));

    const csv = await request('/api/admin/participants.csv');
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(await csv.text()).toContain('Student Person');
  });
});

describe('admin mutations and audit history', () => {
  it('queues a Discord identity refresh for the active roster', async () => {
    const response = await app.request('/api/admin/participants/sync-discord', {
      method: 'POST',
      headers: { Cookie: await cookieFor(ADMIN_ID, true), 'Content-Type': 'application/json' },
      body: '{}',
    }, { ...env, ALLOWED_GUILD_IDS: 'guild-1', DISCORD_TOKEN: 'bot-token' });
    expect(response.status).toBe(200);
    expect(await response.json<any>()).toMatchObject({ ok: true, queued: 2 });
    const queued = await env.DB.prepare(
      "SELECT payload FROM outbox WHERE kind = 'discord_identity_sync' ORDER BY id",
    ).all<any>();
    expect(queued.results.map((row) => JSON.parse(row.payload))).toEqual(expect.arrayContaining([
      { guildId: 'guild-1', userId: 'admin-9101' },
      { guildId: 'guild-1', userId: 'student-9102' },
    ]));
  });

  it('bulk changes participant status and queues opted-in messages', async () => {
    const status = await request('/api/admin/participants/status', {
      method: 'POST',
      body: JSON.stringify({ ids: [STUDENT_ID], status: 'held', note: 'Needs organizer follow-up' }),
    });
    expect(status.status).toBe(200);
    expect(await env.DB.prepare('SELECT status FROM participants WHERE id = ?1').bind(STUDENT_ID).first()).toEqual({ status: 'held' });

    const message = await request('/api/admin/participants/message', {
      method: 'POST',
      body: JSON.stringify({ ids: [STUDENT_ID], channel: 'email', message: 'Please check your WTA schedule.' }),
    });
    expect(await message.json<any>()).toMatchObject({ ok: true, queued: 1, skipped: 0 });
    const queued = await env.DB.prepare("SELECT payload FROM outbox WHERE kind = 'email' ORDER BY id DESC LIMIT 1").first<any>();
    expect(JSON.parse(queued.payload)).toMatchObject({ to: 'student@example.com', subject: 'A message from WTA organizers' });

    const audit = await env.DB.prepare("SELECT action, detail FROM audit_log WHERE action = 'participants.status_changed'").first<any>();
    expect(audit.action).toBe('participants.status_changed');
    expect(JSON.parse(audit.detail)).toMatchObject({ status: 'held', note: 'Needs organizer follow-up' });

    await request('/api/admin/participants/status', {
      method: 'POST',
      body: JSON.stringify({ ids: [STUDENT_ID], status: 'active' }),
    });
  });

  it('verifies and resets reviews with audit entries', async () => {
    const verify = await request('/api/admin/reviews/9201', {
      method: 'POST',
      body: JSON.stringify({ action: 'verify', note: 'Recording reviewed' }),
    });
    expect(await verify.json<any>()).toMatchObject({ ok: true, state: 'verified' });
    expect(await env.DB.prepare('SELECT review_state FROM sessions WHERE id = 9201').first()).toEqual({ review_state: 'verified' });

    const reset = await request('/api/admin/reviews/9201', {
      method: 'POST',
      body: JSON.stringify({ action: 'reset' }),
    });
    expect(await reset.json<any>()).toMatchObject({ ok: true, state: 'pending' });
  });

  it('creates and edits problems', async () => {
    const create = await request('/api/admin/problems', {
      method: 'POST',
      body: JSON.stringify({ title: 'Merge Intervals', difficulty: 'medium', difficultyRank: 2.4, statement: 'Merge overlaps.' }),
    });
    expect(create.status).toBe(201);
    const { id } = await create.json<any>();

    const update = await request(`/api/admin/problems/${id}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Merge Intervals', difficulty: 'medium', difficultyRank: 2.5, active: false, solution: 'Sort first.' }),
    });
    expect(update.status).toBe(200);
    const row = await env.DB.prepare('SELECT difficulty_rank, active, solution_md FROM problems WHERE id = ?1').bind(id).first<any>();
    expect(row).toEqual({ difficulty_rank: 2.5, active: 0, solution_md: 'Sort first.' });
  });

  it('stages and generates problem sets for future rounds', async () => {
    await env.DB.prepare(
      `INSERT INTO problems (id, title, difficulty, difficulty_rank) VALUES
        (9919302, 'Binary Search', 'medium', 2.1),
        (9919303, 'Number of Islands', 'medium', 2.2),
        (9919304, 'Course Schedule', 'medium', 2.3)`,
    ).run();

    const save = await request(`/api/admin/problem-sets/${futureWeekId}`, {
      method: 'PUT',
      body: JSON.stringify({ problemIds: [9919302, 9919303] }),
    });
    expect(save.status).toBe(200);
    expect(await save.json<any>()).toMatchObject({ ok: true, problemIds: [9919302, 9919303] });

    const workspace = await (await request('/api/admin/problems')).json<any>();
    expect(workspace.weeks).toEqual(expect.arrayContaining([expect.objectContaining({ id: futureWeekId, idx: 2 })]));
    expect(workspace.sets).toEqual(expect.arrayContaining([
      expect.objectContaining({ week_id: futureWeekId, problem_id: 9919302 }),
      expect.objectContaining({ week_id: futureWeekId, problem_id: 9919303 }),
    ]));

    const generate = await request(`/api/admin/problem-sets/${futureWeekId}/generate`, {
      method: 'POST',
      body: JSON.stringify({ size: 1 }),
    });
    expect(generate.status).toBe(200);
    expect((await generate.json<any>()).chosen).toEqual([
      expect.objectContaining({ id: 9919304 }),
    ]);
    expect(await env.DB.prepare('SELECT COUNT(*) AS count FROM week_problem_sets WHERE week_id = ?1').bind(futureWeekId).first()).toEqual({ count: 1 });

    const audits = await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action IN ('problem_set.replaced', 'problem_set.generated') ORDER BY id",
    ).all<any>();
    expect(audits.results.map((row) => row.action)).toEqual(['problem_set.replaced', 'problem_set.generated']);
  });

  it('updates program settings and creates a cohort calendar', async () => {
    const settings = await request('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify({ settings: { packet_mode: 'on', organizer_role_id: 'role-123', unsupported: 'ignored' } }),
    });
    expect(await settings.json<any>()).toMatchObject({ ok: true, updated: 2 });
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'packet_mode'").first()).toEqual({ value: 'on' });

    const cohort = await request('/api/admin/cohorts', {
      method: 'POST',
      body: JSON.stringify({ name: 'Fall 2027', startDate: '2027-09-12', rounds: 3 }),
    });
    expect(cohort.status).toBe(201);
    const created = await cohort.json<any>();
    expect(created.weeks).toHaveLength(3);
    expect(await env.DB.prepare("SELECT status FROM cohorts WHERE name = 'Admin API Cohort'").first()).toEqual({ status: 'done' });

    const invalidDate = await request('/api/admin/cohorts', {
      method: 'POST',
      body: JSON.stringify({ name: 'Impossible date', startDate: '2027-02-30', rounds: 3 }),
    });
    expect(invalidDate.status).toBe(400);
  });

  it('surfaces operations and retries dead outbox rows', async () => {
    await env.DB.prepare(
      `INSERT INTO outbox (id, kind, payload, run_after, attempts, last_error) VALUES (9501, 'email', '{}', ?1, 5, 'mail failed')`,
    ).bind(new Date(Date.now() + 86400_000).toISOString()).run();
    const operations = await (await request('/api/admin/operations')).json<any>();
    expect(operations.outbox).toEqual(expect.arrayContaining([expect.objectContaining({ id: 9501, attempts: 5 })]));

    const retry = await request('/api/admin/operations/outbox/9501/retry', { method: 'POST', body: '{}' });
    expect(retry.status).toBe(200);
    expect(await env.DB.prepare('SELECT attempts, last_error FROM outbox WHERE id = 9501').first()).toEqual({ attempts: 0, last_error: null });
  });
});
