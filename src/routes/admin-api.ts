import { Hono } from 'hono';
import { getSettings, setSetting, type SettingKey } from '../config';
import { enqueue } from '../engine/outbox';
import { maybeMarkEligible } from '../engine/reports';
import { activeCohort, cohortWeeks, createCohort } from '../engine/weeks';
import type { Env } from '../env';
import { listParticipants, participantsToCsv } from '../participants';
import { sessionFrom, type SessionUser } from './web';

export const adminApi = new Hono<{ Bindings: Env }>();

const participantStatuses = new Set(['active', 'paused', 'held', 'removed', 'completed']);
const editableSettingKeys = new Set<SettingKey>([
  'announce_channel_id', 'organizer_channel_id', 'threads_channel_id',
  'start_here_channel_id', 'intro_channel_id', 'member_role_id',
  'participant_role_id', 'organizer_role_id', 'packet_mode',
]);

async function requireOrganizer(c: any): Promise<SessionUser | Response> {
  const session = await sessionFrom(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  if (!session.organizer) return c.json({ error: 'forbidden' }, 403);
  return session;
}

async function audit(
  env: Env,
  actorId: number,
  action: string,
  targetType?: string,
  targetId?: string | number,
  detail?: unknown,
) {
  await env.DB.prepare(
    `INSERT INTO audit_log (actor_participant_id, action, target_type, target_id, detail)
     VALUES (?1, ?2, ?3, ?4, ?5)`,
  ).bind(
    actorId,
    action,
    targetType ?? null,
    targetId == null ? null : String(targetId),
    detail == null ? null : JSON.stringify(detail),
  ).run();
}

const count = async (env: Env, sql: string, ...bindings: unknown[]) => {
  const row = await env.DB.prepare(sql).bind(...bindings).first<{ n: number }>();
  return Number(row?.n ?? 0);
};

adminApi.get('/api/admin/overview', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const cohort = await activeCohort(c.env);
  const weeks = cohort ? await cohortWeeks(c.env, cohort.id) : [];
  const now = Date.now();
  const currentWeek = weeks.find((week) => now <= new Date(week.reports_due_at).getTime()) ?? weeks.at(-1) ?? null;

  const [statuses, sessionStates, openForms, incidents, repairs, reviews, pendingOutbox, failedOutbox, recentAudit] = await Promise.all([
    c.env.DB.prepare('SELECT status, count(*) AS n FROM participants GROUP BY status ORDER BY status').all<any>(),
    currentWeek
      ? c.env.DB.prepare('SELECT state, count(*) AS n FROM sessions WHERE week_id = ?1 GROUP BY state').bind(currentWeek.id).all<any>()
      : Promise.resolve({ results: [] as any[] }),
    count(c.env, 'SELECT count(*) AS n FROM form_instances WHERE submitted_at IS NULL'),
    count(c.env, "SELECT count(*) AS n FROM incidents WHERE state = 'open'"),
    count(c.env, "SELECT count(*) AS n FROM repair_queue WHERE state = 'open'"),
    count(c.env, "SELECT count(*) AS n FROM sessions WHERE review_state IN ('pending', 'flagged')"),
    count(c.env, 'SELECT count(*) AS n FROM outbox WHERE done_at IS NULL AND attempts < 5'),
    count(c.env, 'SELECT count(*) AS n FROM outbox WHERE done_at IS NULL AND attempts >= 5'),
    c.env.DB.prepare(
      `SELECT a.*, p.name AS actor_name FROM audit_log a
       LEFT JOIN participants p ON p.id = a.actor_participant_id ORDER BY a.id DESC LIMIT 8`,
    ).all<any>(),
  ]);

  const activeParticipants = Number(statuses.results.find((row: any) => row.status === 'active')?.n ?? 0);
  return c.json({
    cohort,
    currentWeek,
    participantStatuses: statuses.results,
    activeParticipants,
    matchingReady: activeParticipants >= 3,
    sessionStates: sessionStates.results,
    queues: { openForms, incidents, repairs, reviews, pendingOutbox, failedOutbox },
    recentAudit: recentAudit.results,
  });
});

adminApi.get('/api/admin/participants', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const cohort = await activeCohort(c.env);
  const weeks = cohort ? await cohortWeeks(c.env, cohort.id) : [];
  const currentWeek = weeks.at(-1) ?? null;
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.discord_id, p.name, p.preferred_email, p.western_email, p.year, p.program,
            p.status, p.email_ok, p.created_at,
            (SELECT count(*) FROM sessions s WHERE s.interviewer_id = p.id AND s.interviewer_credited = 1) AS interviewer_credits,
            (SELECT count(*) FROM sessions s WHERE s.interviewee_id = p.id AND s.interviewee_credited = 1) AS interviewee_credits,
            (SELECT count(*) FROM incidents i WHERE i.accused_id = p.id AND i.state = 'confirmed' AND i.kind IN ('ghost','unresponsive')) AS strikes,
            (SELECT count(*) FROM form_instances f WHERE f.assignee_id = p.id AND f.submitted_at IS NULL) AS reports_owed,
            ${currentWeek ? '(SELECT count(*) FROM optins o WHERE o.participant_id = p.id AND o.week_id = ?1)' : '0'} AS opted_in
     FROM participants p ORDER BY lower(coalesce(p.name, '')), p.id`,
  ).bind(...(currentWeek ? [currentWeek.id] : [])).all<any>();
  return c.json({ participants: results, cohort, currentWeek });
});

adminApi.get('/api/admin/participants.csv', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const csv = participantsToCsv(await listParticipants(c.env));
  return c.body(csv, 200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="wta-participants.csv"',
  });
});

adminApi.get('/api/admin/participants/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid_id' }, 400);
  const participant = await c.env.DB.prepare('SELECT * FROM participants WHERE id = ?1').bind(id).first<any>();
  if (!participant) return c.json({ error: 'not_found' }, 404);
  const [sessions, incidents, auditRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, w.idx AS round, pi.name AS interviewer_name, pe.name AS interviewee_name, pr.title AS problem_title,
              (SELECT count(*) FROM form_instances f WHERE f.session_id = s.id AND f.submitted_at IS NOT NULL) AS reports_in
       FROM sessions s JOIN weeks w ON w.id = s.week_id
       JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
       LEFT JOIN problems pr ON pr.id = s.problem_id
       WHERE s.interviewer_id = ?1 OR s.interviewee_id = ?1 ORDER BY w.idx, s.id`,
    ).bind(id).all<any>(),
    c.env.DB.prepare(
      `SELECT i.*, reporter.name AS reporter_name FROM incidents i
       LEFT JOIN participants reporter ON reporter.id = i.reporter_id
       WHERE i.accused_id = ?1 OR i.reporter_id = ?1 ORDER BY i.id DESC`,
    ).bind(id).all<any>(),
    c.env.DB.prepare(
      `SELECT a.*, actor.name AS actor_name FROM audit_log a LEFT JOIN participants actor ON actor.id = a.actor_participant_id
       WHERE a.target_type = 'participant' AND a.target_id = ?1 ORDER BY a.id DESC LIMIT 20`,
    ).bind(String(id)).all<any>(),
  ]);
  return c.json({ participant, sessions: sessions.results, incidents: incidents.results, audit: auditRows.results });
});

adminApi.post('/api/admin/participants/status', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ ids?: number[]; status?: string; note?: string }>().catch(() => null);
  const ids = [...new Set(body?.ids?.filter(Number.isInteger) ?? [])].slice(0, 200);
  const status = body?.status ?? '';
  if (!ids.length || !participantStatuses.has(status)) return c.json({ error: 'invalid_request' }, 400);
  const statement = c.env.DB.prepare('UPDATE participants SET status = ?2, removed_reason = ?3, updated_at = datetime(\'now\') WHERE id = ?1');
  await c.env.DB.batch(ids.map((id) => statement.bind(id, status, status === 'removed' ? 'organizer' : null)));
  await audit(c.env, gate.participantId, 'participants.status_changed', 'participant_batch', ids.join(','), { status, note: body?.note?.slice(0, 500) });
  return c.json({ ok: true, updated: ids.length });
});

adminApi.post('/api/admin/participants/message', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ ids?: number[]; message?: string; channel?: 'dm' | 'email' }>().catch(() => null);
  const ids = [...new Set(body?.ids?.filter(Number.isInteger) ?? [])].slice(0, 200);
  const message = body?.message?.trim().slice(0, 1900) ?? '';
  const channel = body?.channel;
  if (!ids.length || !message || (channel !== 'dm' && channel !== 'email')) return c.json({ error: 'invalid_request' }, 400);
  const placeholders = ids.map((_, index) => `?${index + 1}`).join(',');
  const { results } = await c.env.DB.prepare(
    `SELECT id, discord_id, preferred_email, email_ok FROM participants WHERE id IN (${placeholders})`,
  ).bind(...ids).all<any>();
  let queued = 0;
  for (const participant of results) {
    if (channel === 'dm' && participant.discord_id) {
      await enqueue(c.env, 'dm', { userId: participant.discord_id, message: { content: message } });
      queued++;
    } else if (channel === 'email' && participant.email_ok && participant.preferred_email) {
      await enqueue(c.env, 'email', { to: participant.preferred_email, subject: 'A message from WTA organizers', text: message });
      queued++;
    }
  }
  await audit(c.env, gate.participantId, 'participants.message_queued', 'participant_batch', ids.join(','), { channel, queued });
  return c.json({ ok: true, queued, skipped: ids.length - queued });
});

adminApi.get('/api/admin/rounds', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const cohort = await activeCohort(c.env);
  if (!cohort) return c.json({ cohort: null, weeks: [], selectedWeek: null, sessions: [], optins: [], repairs: [] });
  const weeks = await cohortWeeks(c.env, cohort.id);
  const requested = Number(c.req.query('week'));
  const selectedWeek = weeks.find((week) => week.id === requested) ?? weeks.at(-1)!;
  const [sessions, optins, repairs] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, pi.name AS interviewer_name, pe.name AS interviewee_name, p.title AS problem_title,
              (SELECT count(*) FROM form_instances f WHERE f.session_id = s.id AND f.submitted_at IS NOT NULL) AS reports_in
       FROM sessions s JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
       LEFT JOIN problems p ON p.id = s.problem_id WHERE s.week_id = ?1 ORDER BY s.id`,
    ).bind(selectedWeek.id).all<any>(),
    c.env.DB.prepare(
      `SELECT o.*, p.name, p.status FROM optins o JOIN participants p ON p.id = o.participant_id
       WHERE o.week_id = ?1 ORDER BY lower(p.name)`,
    ).bind(selectedWeek.id).all<any>(),
    c.env.DB.prepare(
      `SELECT r.*, p.name FROM repair_queue r JOIN participants p ON p.id = r.participant_id
       WHERE r.week_id = ?1 ORDER BY r.state, r.id`,
    ).bind(selectedWeek.id).all<any>(),
  ]);
  return c.json({ cohort, weeks, selectedWeek, sessions: sessions.results, optins: optins.results, repairs: repairs.results });
});

adminApi.get('/api/admin/reviews', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.review_state, s.state, w.idx AS round, pi.name AS interviewer_name, pe.name AS interviewee_name,
            pe.id AS interviewee_id,
            json_extract(ie.payload, '$.video_url') AS video_url,
            json_extract(ir.payload, '$.verdict') AS verdict,
            json_extract(ir.payload, '$.verdict_reason') AS verdict_reason
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
     LEFT JOIN form_instances ie ON ie.session_id = s.id AND ie.kind = 'interviewee_report' AND ie.submitted_at IS NOT NULL
     LEFT JOIN form_instances ir ON ir.session_id = s.id AND ir.kind = 'interviewer_report' AND ir.submitted_at IS NOT NULL
     WHERE s.review_state != 'none' OR ie.id IS NOT NULL
     ORDER BY CASE s.review_state WHEN 'pending' THEN 0 WHEN 'flagged' THEN 1 WHEN 'verified' THEN 2 ELSE 3 END, s.id DESC`,
  ).all<any>();
  return c.json({ reviews: results });
});

adminApi.post('/api/admin/reviews/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  const body = await c.req.json<{ action?: 'verify' | 'flag' | 'reset'; note?: string }>().catch(() => null);
  const states = { verify: 'verified', flag: 'flagged', reset: 'pending' } as const;
  if (!Number.isInteger(id) || !body?.action || !(body.action in states)) return c.json({ error: 'invalid_request' }, 400);
  const row = await c.env.DB.prepare('SELECT interviewee_id FROM sessions WHERE id = ?1').bind(id).first<{ interviewee_id: number }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare('UPDATE sessions SET review_state = ?2 WHERE id = ?1').bind(id, states[body.action]).run();
  if (body.action === 'verify') await maybeMarkEligible(c.env, row.interviewee_id);
  await audit(c.env, gate.participantId, `review.${body.action}`, 'session', id, { note: body.note?.slice(0, 500) });
  return c.json({ ok: true, state: states[body.action] });
});

adminApi.get('/api/admin/problems', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const [problems, sets] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.*, (SELECT count(*) FROM sessions s WHERE s.problem_id = p.id) AS uses,
              (SELECT count(*) FROM exposures e WHERE e.problem_id = p.id) AS exposures
       FROM problems p ORDER BY p.active DESC, p.difficulty_rank, lower(p.title)`,
    ).all<any>(),
    c.env.DB.prepare(
      `SELECT wps.week_id, w.idx AS round, c.name AS cohort_name, p.id AS problem_id, p.title
       FROM week_problem_sets wps JOIN weeks w ON w.id = wps.week_id JOIN cohorts c ON c.id = w.cohort_id
       JOIN problems p ON p.id = wps.problem_id ORDER BY c.id DESC, w.idx, p.title`,
    ).all<any>(),
  ]);
  return c.json({ problems: problems.results, sets: sets.results });
});

adminApi.post('/api/admin/problems', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<any>().catch(() => null);
  if (!body?.title?.trim() || !['easy', 'medium', 'hard'].includes(body.difficulty)) return c.json({ error: 'invalid_request' }, 400);
  const result = await c.env.DB.prepare(
    `INSERT INTO problems (source, number, title, url, difficulty, difficulty_rank, statement_md, hints_md, solution_md, active)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
  ).bind(
    String(body.source ?? 'manual').slice(0, 50), body.number ? Number(body.number) : null,
    String(body.title).trim().slice(0, 200), String(body.url ?? '').trim().slice(0, 1000) || null,
    body.difficulty, body.difficultyRank == null ? null : Number(body.difficultyRank),
    String(body.statement ?? '').slice(0, 50000) || null, String(body.hints ?? '').slice(0, 20000) || null,
    String(body.solution ?? '').slice(0, 50000) || null, body.active === false ? 0 : 1,
  ).run();
  const id = Number(result.meta.last_row_id);
  await audit(c.env, gate.participantId, 'problem.created', 'problem', id, { title: body.title });
  return c.json({ ok: true, id }, 201);
});

adminApi.post('/api/admin/problems/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  const body = await c.req.json<any>().catch(() => null);
  if (!Number.isInteger(id) || !body?.title?.trim() || !['easy', 'medium', 'hard'].includes(body.difficulty)) return c.json({ error: 'invalid_request' }, 400);
  const result = await c.env.DB.prepare(
    `UPDATE problems SET number = ?2, title = ?3, url = ?4, difficulty = ?5, difficulty_rank = ?6,
       statement_md = ?7, hints_md = ?8, solution_md = ?9, active = ?10 WHERE id = ?1`,
  ).bind(
    id, body.number ? Number(body.number) : null, String(body.title).trim().slice(0, 200),
    String(body.url ?? '').trim().slice(0, 1000) || null, body.difficulty,
    body.difficultyRank == null ? null : Number(body.difficultyRank), String(body.statement ?? '').slice(0, 50000) || null,
    String(body.hints ?? '').slice(0, 20000) || null, String(body.solution ?? '').slice(0, 50000) || null,
    body.active === false ? 0 : 1,
  ).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  await audit(c.env, gate.participantId, 'problem.updated', 'problem', id, { title: body.title });
  return c.json({ ok: true });
});

adminApi.get('/api/admin/analytics', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const [participants, sessions, reports, verdicts, problems, rounds] = await Promise.all([
    c.env.DB.prepare('SELECT status, count(*) AS value FROM participants GROUP BY status').all<any>(),
    c.env.DB.prepare('SELECT state AS label, count(*) AS value FROM sessions GROUP BY state').all<any>(),
    c.env.DB.prepare(`SELECT kind AS label, count(*) AS total, sum(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted FROM form_instances GROUP BY kind`).all<any>(),
    c.env.DB.prepare(`SELECT json_extract(payload, '$.verdict') AS label, count(*) AS value FROM form_instances WHERE kind = 'interviewer_report' AND submitted_at IS NOT NULL GROUP BY label`).all<any>(),
    c.env.DB.prepare(
      `SELECT p.id, p.title, p.difficulty, count(s.id) AS uses,
              avg(CAST(json_extract(f.payload, '$.rating_experience') AS REAL)) AS avg_experience
       FROM problems p LEFT JOIN sessions s ON s.problem_id = p.id
       LEFT JOIN form_instances f ON f.session_id = s.id AND f.kind = 'interviewee_report' AND f.submitted_at IS NOT NULL
       GROUP BY p.id ORDER BY uses DESC, p.title LIMIT 20`,
    ).all<any>(),
    c.env.DB.prepare(
      `SELECT c.name AS cohort, w.idx AS round, count(DISTINCT o.participant_id) AS optins, count(DISTINCT s.id) AS sessions,
              sum(CASE WHEN s.state = 'completed' THEN 1 ELSE 0 END) AS completed
       FROM weeks w JOIN cohorts c ON c.id = w.cohort_id
       LEFT JOIN optins o ON o.week_id = w.id LEFT JOIN sessions s ON s.week_id = w.id
       GROUP BY w.id ORDER BY c.id, w.idx`,
    ).all<any>(),
  ]);
  return c.json({ participants: participants.results, sessions: sessions.results, reports: reports.results, verdicts: verdicts.results, problems: problems.results, rounds: rounds.results });
});

adminApi.get('/api/admin/operations', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const [outbox, notifications, jobs, auditRows] = await Promise.all([
    c.env.DB.prepare(`SELECT id, kind, attempts, run_after, done_at, last_error, created_at FROM outbox ORDER BY id DESC LIMIT 100`).all<any>(),
    c.env.DB.prepare(`SELECT n.*, p.name FROM notify_log n LEFT JOIN participants p ON p.id = n.participant_id ORDER BY n.id DESC LIMIT 100`).all<any>(),
    c.env.DB.prepare('SELECT * FROM job_runs ORDER BY ran_at DESC LIMIT 100').all<any>(),
    c.env.DB.prepare(`SELECT a.*, p.name AS actor_name FROM audit_log a LEFT JOIN participants p ON p.id = a.actor_participant_id ORDER BY a.id DESC LIMIT 100`).all<any>(),
  ]);
  return c.json({ outbox: outbox.results, notifications: notifications.results, jobs: jobs.results, audit: auditRows.results });
});

adminApi.post('/api/admin/operations/outbox/:id/retry', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  const result = await c.env.DB.prepare(
    `UPDATE outbox SET attempts = 0, last_error = NULL, run_after = ?2 WHERE id = ?1 AND done_at IS NULL`,
  ).bind(id, new Date().toISOString()).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  await audit(c.env, gate.participantId, 'outbox.retry', 'outbox', id);
  return c.json({ ok: true });
});

adminApi.get('/api/admin/settings', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const keys = [...editableSettingKeys];
  const [settings, cohorts, rosterSize] = await Promise.all([
    getSettings(c.env, keys),
    c.env.DB.prepare('SELECT * FROM cohorts ORDER BY id DESC').all<any>(),
    count(c.env, "SELECT count(*) AS n FROM participants WHERE status = 'active'"),
  ]);
  return c.json({ settings, cohorts: cohorts.results, activeParticipants: rosterSize, minimumMatchingPool: 3 });
});

adminApi.post('/api/admin/settings', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ settings?: Record<string, string> }>().catch(() => null);
  if (!body?.settings || typeof body.settings !== 'object') return c.json({ error: 'invalid_request' }, 400);
  const entries = Object.entries(body.settings).filter(([key]) => editableSettingKeys.has(key as SettingKey));
  for (const [key, value] of entries) await setSetting(c.env, key as SettingKey, String(value).trim().slice(0, 200));
  await audit(c.env, gate.participantId, 'program.settings_updated', 'settings', undefined, Object.fromEntries(entries));
  return c.json({ ok: true, updated: entries.length });
});

adminApi.post('/api/admin/cohorts', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ name?: string; startDate?: string; rounds?: number }>().catch(() => null);
  const match = body?.startDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const rounds = Number(body?.rounds ?? 3);
  if (!body?.name?.trim() || !match || !Number.isInteger(rounds) || rounds < 1 || rounds > 8) return c.json({ error: 'invalid_request' }, 400);
  const created = await createCohort(c.env, body.name.trim().slice(0, 100), [Number(match[1]), Number(match[2]), Number(match[3])], rounds);
  await audit(c.env, gate.participantId, 'cohort.created', 'cohort', created.cohortId, { name: body.name, startDate: body.startDate, rounds });
  return c.json({ ok: true, ...created }, 201);
});
