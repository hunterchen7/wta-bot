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
      (id, discord_id, discord_username, discord_nickname, name, preferred_email, western_email, year, program, opportunities, experience_band, topics, email_ok, status)
     VALUES
      (?1, 'admin-9101', 'admin.account', 'Admin Nick', 'Admin Person', 'admin@example.com', 'admin@uwo.ca', 'Fourth', 'Computer Science', '["new_grad"]', '3-4', '["dsa"]', 1, 'active'),
      (?2, 'student-9102', 'student.account', 'Student Nick', 'Student Person', 'student@example.com', 'student@uwo.ca', 'Third', 'Software Engineering', '["internships"]', '1-2', '["dsa"]', 1, 'active')`,
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
       (9402, 'interviewer_report', 9201, ?4, 'admin-api-ir', ?2, ?3, '{}')`,
  ).bind(STUDENT_ID, new Date(Date.now() + 86400_000).toISOString(), new Date().toISOString(), ADMIN_ID).run();
  const resumeKey = `resumes/${STUDENT_ID}/admin-test.pdf`;
  const resumeBytes = new TextEncoder().encode('%PDF-1.4\nadmin-visible private resume');
  await env.RECORDINGS!.put(resumeKey, resumeBytes, { httpMetadata: { contentType: 'application/pdf' } });
  await env.DB.prepare(
    `UPDATE participants SET linkedin_url = 'https://www.linkedin.com/in/student-person',
      other_url = 'https://student.example.com', resume_object_key = ?2,
      resume_filename = 'Student Person Resume.pdf', resume_content_type = 'application/pdf',
      resume_bytes = ?3, resume_uploaded_at = ?4 WHERE id = ?1`,
  ).bind(STUDENT_ID, resumeKey, resumeBytes.byteLength, new Date().toISOString()).run();
  await env.DB.prepare(
    `INSERT INTO enrollment_events (discord_id, discord_username, event_type, source, flow, created_at) VALUES
       ('funnel-1', 'link.only', 'link_generated', 'join_button', 'enrollment', '2026-07-13T14:00:00.000Z'),
       ('funnel-2', 'form.opened', 'link_generated', 'join_command', 'enrollment', '2026-07-13T14:01:00.000Z'),
       ('funnel-2', 'form.opened', 'form_opened', 'web', 'enrollment', '2026-07-13T14:02:00.000Z'),
       ('funnel-3', 'completed.user', 'link_generated', 'join_button', 'enrollment', '2026-07-13T14:03:00.000Z'),
       ('funnel-3', 'completed.user', 'form_opened', 'web', 'enrollment', '2026-07-13T14:04:00.000Z'),
       ('funnel-3', 'completed.user', 'enrollment_completed', 'web', 'enrollment', '2026-07-13T14:05:00.000Z'),
       ('funnel-3', 'completed.user', 'link_generated', 'join_command', 'profile_edit', '2026-07-13T15:00:00.000Z')`,
  ).run();
});

describe('admin JSON API authorization', () => {
  it('rejects anonymous and participant sessions', async () => {
    expect((await app.request('/api/admin/overview', {}, env)).status).toBe(401);
    expect((await request('/api/admin/overview', {}, false)).status).toBe(403);
    expect((await app.request('/api/admin/previews/interviewee_report', {}, env)).status).toBe(401);
    expect((await request('/api/admin/previews/interviewee_report', {}, false)).status).toBe(403);
    expect((await app.request('/api/public/previews/interviewee_report', {}, env)).status).toBe(404);
  });
});

describe('admin operational data', () => {
  it('serves organizer-only previews and discards completed test uploads', async () => {
    const before = await env.DB.prepare('SELECT count(*) AS n FROM form_instances').first<{ n: number }>();
    for (const kind of ['interviewee_report', 'interviewer_report']) {
      const response = await request(`/api/admin/previews/${kind}`);
      expect(response.status).toBe(200);
      const preview = await response.json<any>();
      expect(preview).toMatchObject({ preview: true, kind, fields: expect.any(Array) });
      expect(preview.fields.length).toBeGreaterThan(5);
    }
    expect((await request('/api/admin/previews/nope')).status).toBe(404);
    expect(await env.DB.prepare('SELECT count(*) AS n FROM form_instances').first()).toEqual(before);

    const bytes = new TextEncoder().encode('temporary organizer preview recording');
    const initialized = await request('/api/admin/previews/recording/init', {
      method: 'POST',
      body: JSON.stringify({ filename: 'preview.webm', size: bytes.byteLength, contentType: 'video/webm' }),
    });
    expect(initialized.status).toBe(200);
    const upload = await initialized.json<{ key: string; uploadId: string; partSize: number }>();
    expect(upload.key).toMatch(/^previews\/9101\//);

    const uploaded = await request('/api/admin/previews/recording/part/1', {
      method: 'PUT', body: bytes,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(bytes.byteLength),
        'X-WTA-Object-Key': upload.key,
        'X-WTA-Upload-Id': upload.uploadId,
      },
    });
    expect(uploaded.status).toBe(200);
    const part = await uploaded.json<{ partNumber: number; etag: string }>();
    const completed = await request('/api/admin/previews/recording/complete', {
      method: 'POST', body: JSON.stringify({ key: upload.key, uploadId: upload.uploadId, parts: [part] }),
    });
    expect(completed.status).toBe(200);
    expect(await completed.json<any>()).toMatchObject({ ok: true, storedBytes: bytes.byteLength });
    expect(await env.RECORDINGS!.get(upload.key)).toBeNull();
  });

  it('returns overview queues and matching readiness', async () => {
    const response = await request('/api/admin/overview');
    expect(response.status).toBe(200);
    const body = await response.json<any>();
    expect(body.cohort.name).toBe('Admin API Cohort');
    expect(body.activeParticipants).toBe(2);
    expect(body.matchingReady).toBe(false);
    expect(body.queues).toMatchObject({ reviews: 1, failedOutbox: 0 });
  });

  it('returns enrollment funnel counts and person-level activity in Operations', async () => {
    const response = await request('/api/admin/operations');
    expect(response.status).toBe(200);
    const funnel = (await response.json<any>()).enrollmentFunnel;
    expect(funnel).toMatchObject({ generated: 3, linksIssued: 3, totalLinksIssued: 4, opened: 2, completed: 1 });
    expect(funnel.people).toEqual(expect.arrayContaining([
      expect.objectContaining({ discord_id: 'funnel-1', discord_username: 'link.only', status: 'link_generated' }),
      expect.objectContaining({ discord_id: 'funnel-2', discord_username: 'form.opened', status: 'in_progress' }),
      expect.objectContaining({ discord_id: 'funnel-3', discord_username: 'completed.user', status: 'completed' }),
    ]));
    expect(funnel.recentLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ discord_id: 'funnel-1', source: 'join_button', flow: 'enrollment' }),
      expect.objectContaining({ discord_id: 'funnel-3', source: 'join_command', flow: 'profile_edit' }),
    ]));
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
        experience_band: '1-2',
        opportunities: '["internships"]',
        topics: '["dsa"]',
      }),
    ]));

    const detail = await (await request(`/api/admin/participants/${STUDENT_ID}`)).json<any>();
    expect(detail.participant.name).toBe('Student Person');
    expect(detail.participant).toMatchObject({ linkedin_url: 'https://www.linkedin.com/in/student-person', other_url: 'https://student.example.com', resume: { filename: 'Student Person Resume.pdf' } });
    expect(detail.participant.resume_object_key).toBeUndefined();
    expect(detail.sessions[0]).toMatchObject({ id: 9201, problem_title: 'Two Sum' });
    expect(detail.sessions[0].forms).toEqual([
      expect.objectContaining({ id: 9401, kind: 'interviewee_report', session_id: 9201, submitted_at: expect.any(String), url: expect.stringMatching(/^\/f\/f:9401\./) }),
    ]);

    expect((await app.request(`/api/admin/participants/${STUDENT_ID}/resume`, {}, env)).status).toBe(401);
    expect((await request(`/api/admin/participants/${STUDENT_ID}/resume`, {}, false)).status).toBe(403);
    const resume = await request(`/api/admin/participants/${STUDENT_ID}/resume`);
    expect(resume.status).toBe(200);
    expect(resume.headers.get('content-disposition')).toContain('Student_Person_Resume.pdf');
    expect(new TextDecoder().decode(await resume.arrayBuffer())).toContain('admin-visible private resume');

    const rounds = await (await request(`/api/admin/rounds?week=${weekId}`)).json<any>();
    expect(rounds.sessions[0]).toMatchObject({
      id: 9201,
      interviewer_name: 'Admin Person',
      problem_number: null,
      problem_title: 'Two Sum',
      problem_difficulty: 'easy',
      packet_sent_at: null,
    });
    expect(rounds.selectedWeek.id).toBe(weekId);
    expect(rounds.participants).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: STUDENT_ID, name: 'Student Person', discord_username: 'student.account' }),
    ]));

    await env.DB.prepare(
      `INSERT INTO optins (week_id, participant_id) VALUES (?1, ?2), (?1, ?3)`,
    ).bind(weekId, ADMIN_ID, STUDENT_ID).run();
    const analytics = await (await request('/api/admin/analytics')).json<any>();
    expect(analytics.reviews).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'pending' })]));
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
  it('adds and removes a round-specific extra interviewer without changing normal opt-in', async () => {
    await env.DB.prepare(
      `INSERT INTO optins (week_id, participant_id, regular_opt_in)
       VALUES (?1, ?2, 1)
       ON CONFLICT(week_id, participant_id) DO UPDATE SET regular_opt_in = 1, extra_interviewer = 0`,
    ).bind(weekId, STUDENT_ID).run();

    const add = await request(`/api/admin/rounds/${weekId}/extra-interviewer`, {
      method: 'POST', body: JSON.stringify({ participantId: STUDENT_ID, enabled: true }),
    });
    expect(add.status).toBe(200);
    expect(await env.DB.prepare(
      'SELECT regular_opt_in, extra_interviewer FROM optins WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(weekId, STUDENT_ID).first()).toEqual({ regular_opt_in: 1, extra_interviewer: 1 });

    const remove = await request(`/api/admin/rounds/${weekId}/extra-interviewer`, {
      method: 'POST', body: JSON.stringify({ participantId: STUDENT_ID, enabled: false }),
    });
    expect(remove.status).toBe(200);
    expect(await env.DB.prepare(
      'SELECT regular_opt_in, extra_interviewer FROM optins WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(weekId, STUDENT_ID).first()).toEqual({ regular_opt_in: 1, extra_interviewer: 0 });

    await env.DB.prepare('DELETE FROM optins WHERE week_id = ?1 AND participant_id = ?2').bind(weekId, ADMIN_ID).run();
    await request(`/api/admin/rounds/${weekId}/extra-interviewer`, {
      method: 'POST', body: JSON.stringify({ participantId: ADMIN_ID, enabled: true }),
    });
    expect(await env.DB.prepare(
      'SELECT regular_opt_in, extra_interviewer FROM optins WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(weekId, ADMIN_ID).first()).toEqual({ regular_opt_in: 0, extra_interviewer: 1 });
    await request(`/api/admin/rounds/${weekId}/extra-interviewer`, {
      method: 'POST', body: JSON.stringify({ participantId: ADMIN_ID, enabled: false }),
    });
    expect(await env.DB.prepare(
      'SELECT id FROM optins WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(weekId, ADMIN_ID).first()).toBeNull();

    expect(await env.DB.prepare(
      "SELECT action FROM audit_log WHERE action = 'round.extra_interviewer_changed' ORDER BY id DESC LIMIT 1",
    ).first()).toEqual({ action: 'round.extra_interviewer_changed' });
  });

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
      body: JSON.stringify({ title: 'Merge Intervals', difficulty: 'medium', difficultyRank: 2.4, availableWeeks: [2, 3], content: '## Statement\n\nMerge overlaps.\n\n## Hints\n\nSort first.\n\n## Solution\n\nSweep once.' }),
    });
    expect(create.status).toBe(201);
    const { id } = await create.json<any>();

    const update = await request(`/api/admin/problems/${id}`, {
      method: 'POST',
      body: JSON.stringify({ title: 'Merge Intervals', difficulty: 'medium', difficultyRank: 2.5, active: false, availableWeeks: [3], content: '## Statement\n\nMerge overlaps.\n\n## Hints\n\nSort first.\n\n## Solution\n\nSort first.' }),
    });
    expect(update.status).toBe(200);
    const row = await env.DB.prepare('SELECT difficulty_rank, active, solution_md, available_weeks FROM problems WHERE id = ?1').bind(id).first<any>();
    expect(row).toEqual({ difficulty_rank: 2.5, active: 0, solution_md: 'Sort first.', available_weeks: '[3]' });
  });

  it('stages and generates problem sets for future rounds', async () => {
    await env.DB.prepare(
      `INSERT INTO problems (id, title, difficulty, difficulty_rank, available_weeks) VALUES
        (9919302, 'Binary Search', 'medium', 2.1, '[2]'),
        (9919303, 'Number of Islands', 'medium', 2.2, '[2]'),
        (9919304, 'Course Schedule', 'medium', 2.3, '[2]')`,
    ).run();

    const wrongRound = await request(`/api/admin/problem-sets/${futureWeekId}`, {
      method: 'PUT',
      body: JSON.stringify({ problemIds: [9301] }),
    });
    expect(wrongRound.status).toBe(400);
    expect((await wrongRound.json<any>()).message).toContain('tagged for round 2');

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
      body: JSON.stringify({ settings: { packet_mode: 'on', question_bank_public: 'off', organizer_role_id: 'role-123', unsupported: 'ignored' } }),
    });
    expect(await settings.json<any>()).toMatchObject({ ok: true, updated: 3 });
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'packet_mode'").first()).toEqual({ value: 'on' });
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'question_bank_public'").first()).toEqual({ value: 'off' });

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
    const heartbeat = new Date().toISOString();
    await env.DB.prepare("INSERT INTO job_runs (job_key, ran_at) VALUES (?1, ?2)")
      .bind(`tick:${heartbeat.slice(0, 16)}`, heartbeat).run();
    await env.DB.prepare(
      `INSERT INTO outbox (id, kind, payload, run_after, attempts, last_error) VALUES
        (9501, 'email', '{}', ?1, 5, 'mail failed'),
        (9502, 'email', '{"to":"student@example.com","subject":"Round reminder"}', ?1, 0, NULL)`,
    ).bind(new Date(Date.now() + 86400_000).toISOString()).run();
    const operations = await (await request('/api/admin/operations')).json<any>();
    expect(operations.outbox).toEqual(expect.arrayContaining([expect.objectContaining({ id: 9501, attempts: 5, payload: '{}', dismissed_at: null })]));
    expect(operations.outbox).toEqual(expect.arrayContaining([expect.objectContaining({ id: 9502, participant_name: 'Student Person' })]));
    expect(operations.cron).toMatchObject({ status: 'healthy', lastTickAt: heartbeat, expectedEveryMinutes: 15 });

    const dismiss = await request('/api/admin/operations/outbox/9501/dismiss', { method: 'POST', body: '{}' });
    expect(dismiss.status).toBe(200);
    expect(await env.DB.prepare('SELECT dismissed_at FROM outbox WHERE id = 9501').first()).toEqual({ dismissed_at: expect.any(String) });
    expect((await (await request('/api/admin/overview')).json<any>()).queues.failedOutbox).toBe(0);

    const retry = await request('/api/admin/operations/outbox/9501/retry', { method: 'POST', body: '{}' });
    expect(retry.status).toBe(200);
    expect(await env.DB.prepare('SELECT attempts, last_error, dismissed_at FROM outbox WHERE id = 9501').first()).toEqual({ attempts: 0, last_error: null, dismissed_at: null });
  });
});
