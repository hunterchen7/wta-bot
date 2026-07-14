import { Hono } from 'hono';
import { getSettings, setSetting, type SettingKey } from '../config';
import { enqueue, enqueueMany } from '../engine/outbox';
import { maybeMarkEligible } from '../engine/reports';
import { activeCohort, cohortWeeks, createCohort } from '../engine/weeks';
import type { Env } from '../env';
import { fieldsFor } from '../forms/schema';
import { signToken } from '../forms/token';
import { listParticipants, participantsToCsv } from '../participants';
import { composeQuestionMarkdown, normalizeAvailableWeeks, parseQuestionMarkdown } from '../question-markdown';
import { currentProgramPhase, programTimeline } from '../program-calendar';
import { generateProblemSet, ProblemSetError, problemBankWorkspace, replaceProblemSet } from '../services/problem-sets';
import { writeAdminAudit as audit } from '../services/admin-audit';
import {
  ADMIN_SCOPES,
  createAdminToken,
  decryptAdminToken,
  normalizeAdminScopes,
  PERSONAL_MCP_TOKEN_NAME,
  PERSONAL_MCP_TOKEN_SCOPES,
} from '../services/admin-tokens';
import { sessionFrom, type SessionUser } from './web';
import { isCurrentOrganizer } from '../organizers';
import { participantResume, resumeDownloadHeaders, resumeSummary, ResumeUploadError } from '../services/resumes';
import { enrollmentFunnel } from '../services/enrollment-events';

export const adminApi = new Hono<{ Bindings: Env }>();

const participantStatuses = new Set(['active', 'paused', 'held', 'removed', 'completed']);
const editableSettingKeys = new Set<SettingKey>([
  'announce_channel_id', 'organizer_channel_id', 'threads_channel_id',
  'participant_role_id', 'organizer_role_id', 'packet_mode', 'packet_lead_hours', 'question_bank_public',
]);
const packetLeadOptions = new Set(['scheduled', '1', '6', '12', '24', '48']);
const PREVIEW_RECORDING_PART_BYTES = 16 * 1024 * 1024;
const MAX_PREVIEW_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;

async function requireOrganizer(c: any): Promise<SessionUser | Response> {
  const session = await sessionFrom(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  if (!session.organizer || !(await isCurrentOrganizer(c.env, session.participantId))) {
    return c.json({ error: 'forbidden' }, 403);
  }
  return session;
}

adminApi.get('/api/admin/previews/:kind', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const kind = c.req.param('kind');
  const fields = fieldsFor(kind);
  if (!fields) return c.json({ error: 'not_found', message: 'Unknown preview.' }, 404);
  const viewer = await c.env.DB.prepare(
    'SELECT name, discord_id, discord_username, discord_nickname FROM participants WHERE id = ?1',
  ).bind(gate.participantId).first<{ name: string | null; discord_id: string; discord_username: string | null; discord_nickname: string | null }>();
  return c.json({
    preview: true, id: 0, kind, round: 2,
    role: kind === 'interviewer_report' ? 'interviewer' : 'interviewee',
    assigneeName: viewer?.name ?? 'Alex Example', partnerName: 'Jordan Example',
    assigneeDiscordId: viewer?.discord_id ?? '000000000000000000',
    assigneeDiscordUsername: viewer?.discord_username ?? 'alex.example',
    assigneeDiscordNickname: viewer?.discord_nickname ?? 'Alex Example',
    scheduledAt: '2026-08-12T23:30:00.000Z', deadlineAt: '2026-08-23T03:59:00.000Z',
    submittedAt: null, overdue: false, fields, values: {},
  });
});

adminApi.post('/api/admin/previews/recording/init', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  if (!c.env.RECORDINGS) return c.json({ error: 'recordings_not_configured', message: 'Recording uploads are not configured.' }, 503);
  const body = await c.req.json<{ filename?: string; size?: number; contentType?: string }>().catch(() => null);
  const size = Number(body?.size ?? 0);
  const contentType = String(body?.contentType ?? '').slice(0, 100);
  if (!body?.filename || !Number.isFinite(size) || size <= 0 || size > MAX_PREVIEW_RECORDING_BYTES || !contentType.startsWith('video/')) {
    return c.json({ error: 'invalid_recording', message: 'Choose a supported video no larger than 2 GB.' }, 400);
  }
  const key = `previews/${gate.participantId}/${crypto.randomUUID()}${previewRecordingExtension(contentType)}`;
  const upload = await c.env.RECORDINGS.createMultipartUpload(key, { httpMetadata: { contentType, cacheControl: 'private, no-store' } });
  return c.json({ key, uploadId: upload.uploadId, partSize: PREVIEW_RECORDING_PART_BYTES });
});

adminApi.put('/api/admin/previews/recording/part/:part', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  if (!c.env.RECORDINGS) return c.json({ error: 'recordings_not_configured' }, 503);
  const key = c.req.header('x-wta-object-key') ?? '';
  const uploadId = c.req.header('x-wta-upload-id') ?? '';
  const partNumber = Number(c.req.param('part'));
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (!validPreviewUpload(gate, key, uploadId) || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return c.json({ error: 'invalid_upload' }, 404);
  if (!c.req.raw.body || contentLength <= 0 || contentLength > PREVIEW_RECORDING_PART_BYTES) return c.json({ error: 'invalid_part' }, 400);
  const part = await c.env.RECORDINGS.resumeMultipartUpload(key, uploadId).uploadPart(partNumber, c.req.raw.body);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

adminApi.post('/api/admin/previews/recording/complete', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  if (!c.env.RECORDINGS) return c.json({ error: 'recordings_not_configured' }, 503);
  const body = await c.req.json<{ key?: string; uploadId?: string; parts?: Array<{ partNumber: number; etag: string }> }>().catch(() => null);
  if (!body || !validPreviewUpload(gate, body.key ?? '', body.uploadId ?? '') || !body.parts?.length) return c.json({ error: 'invalid_upload' }, 404);
  const parts = body.parts.filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && typeof part.etag === 'string').sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== body.parts.length) return c.json({ error: 'invalid_parts' }, 400);
  const object = await c.env.RECORDINGS.resumeMultipartUpload(body.key!, body.uploadId!).complete(parts);
  await c.env.RECORDINGS.delete(body.key!);
  return c.json({ ok: true, storedBytes: object.size });
});

adminApi.delete('/api/admin/previews/recording', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  if (!c.env.RECORDINGS) return c.json({ ok: true });
  const body = await c.req.json<{ key?: string; uploadId?: string }>().catch(() => null);
  if (!body || !validPreviewUpload(gate, body.key ?? '', body.uploadId ?? '')) return c.json({ ok: true });
  await c.env.RECORDINGS.resumeMultipartUpload(body.key!, body.uploadId!).abort().catch(() => {});
  return c.json({ ok: true });
});

function validPreviewUpload(session: SessionUser, key: string, uploadId: string) {
  return key.startsWith(`previews/${session.participantId}/`) && key.length <= 200 && uploadId.length > 0 && uploadId.length <= 500;
}

function previewRecordingExtension(contentType: string) {
  if (contentType === 'video/webm') return '.webm';
  if (contentType === 'video/quicktime') return '.mov';
  if (contentType === 'video/x-matroska' || contentType === 'video/matroska') return '.mkv';
  return '.mp4';
}

const count = async (env: Env, sql: string, ...bindings: unknown[]) => {
  const row = await env.DB.prepare(sql).bind(...bindings).first<{ n: number }>();
  return Number(row?.n ?? 0);
};

function currentProgramWeek<T extends { reports_due_at: string }>(weeks: T[]): T | null {
  const now = Date.now();
  return weeks.find((week) => now <= new Date(week.reports_due_at).getTime()) ?? weeks.at(-1) ?? null;
}

adminApi.get('/api/admin/overview', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const cohort = await activeCohort(c.env);
  const weeks = cohort ? await cohortWeeks(c.env, cohort.id) : [];
  const currentWeek = currentProgramWeek(weeks);

  const [statuses, matchingParticipants, sessionStates, openForms, incidents, repairs, reviews, pendingOutbox, failedOutbox, recentAudit] = await Promise.all([
    c.env.DB.prepare(
      `SELECT CASE WHEN pairing_excluded = 1 THEN 'organizer' ELSE status END AS status, count(*) AS n
       FROM participants GROUP BY CASE WHEN pairing_excluded = 1 THEN 'organizer' ELSE status END ORDER BY status`,
    ).all<any>(),
    count(c.env, "SELECT count(*) AS n FROM participants WHERE status = 'active' AND pairing_excluded = 0"),
    currentWeek
      ? c.env.DB.prepare('SELECT state, count(*) AS n FROM sessions WHERE week_id = ?1 GROUP BY state').bind(currentWeek.id).all<any>()
      : Promise.resolve({ results: [] as any[] }),
    count(c.env, 'SELECT count(*) AS n FROM form_instances WHERE submitted_at IS NULL'),
    count(c.env, "SELECT count(*) AS n FROM incidents WHERE state = 'open' AND kind != 'issue'"),
    count(c.env, "SELECT count(*) AS n FROM repair_queue WHERE state = 'open'"),
    count(c.env, "SELECT count(*) AS n FROM sessions WHERE review_state IN ('pending', 'flagged')"),
    count(c.env, 'SELECT count(*) AS n FROM outbox WHERE dismissed_at IS NULL AND done_at IS NULL AND attempts < 5'),
    count(c.env, 'SELECT count(*) AS n FROM outbox WHERE dismissed_at IS NULL AND done_at IS NULL AND attempts >= 5'),
    c.env.DB.prepare(
      `SELECT a.*, p.name AS actor_name FROM audit_log a
       LEFT JOIN participants p ON p.id = a.actor_participant_id ORDER BY a.id DESC LIMIT 8`,
    ).all<any>(),
  ]);

  return c.json({
    cohort,
    currentWeek,
    programWeek: cohort ? currentProgramPhase(cohort) : null,
    participantStatuses: statuses.results,
    activeParticipants: matchingParticipants,
    matchingReady: matchingParticipants >= 3,
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
  const currentWeek = currentProgramWeek(weeks);
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.discord_id, p.discord_username, p.discord_nickname, p.name, p.preferred_email, p.western_email, p.year, p.program,
            p.opportunities, p.prior_wta, p.experience_band, p.topics, p.blurb, p.interests, p.prior_feedback,
            p.linkedin_url, p.other_url, p.resume_filename, p.resume_content_type, p.resume_bytes, p.resume_uploaded_at,
            p.status, p.email_ok, p.pairing_excluded, p.removed_reason, p.created_at, p.updated_at,
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

adminApi.get('/api/admin/participants/:id/resume', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid_id' }, 400);
  try {
    const { object, summary } = await participantResume(c.env, id);
    return new Response(object.body, { headers: resumeDownloadHeaders(summary) });
  } catch (cause) {
    if (cause instanceof ResumeUploadError) return c.json({ error: cause.code, message: cause.message }, cause.status);
    throw cause;
  }
});

adminApi.post('/api/admin/participants/sync-discord', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const guildId = c.env.ALLOWED_GUILD_IDS?.split(',')[0]?.trim();
  if (!guildId || !c.env.DISCORD_TOKEN) {
    return c.json({ error: 'discord_not_configured', message: 'Discord guild access is not configured.' }, 503);
  }
  const { results } = await c.env.DB.prepare(
    "SELECT discord_id FROM participants WHERE status != 'removed' ORDER BY id LIMIT 500",
  ).all<{ discord_id: string }>();
  await enqueueMany(c.env, results.map((participant) => ({
    kind: 'discord_identity_sync' as const,
    payload: { guildId, userId: participant.discord_id },
  })));
  await audit(c.env, gate.participantId, 'participants.discord_sync_queued', 'participant_batch', undefined, { queued: results.length });
  return c.json({ ok: true, queued: results.length });
});

adminApi.get('/api/admin/participants/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid_id' }, 400);
  const participant = await c.env.DB.prepare('SELECT * FROM participants WHERE id = ?1').bind(id).first<any>();
  if (!participant) return c.json({ error: 'not_found' }, 404);
  const [sessions, forms, incidents, auditRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, w.idx AS round, pi.name AS interviewer_name, pe.name AS interviewee_name, pr.title AS problem_title,
              (SELECT count(*) FROM form_instances f WHERE f.session_id = s.id AND f.submitted_at IS NOT NULL) AS reports_in
       FROM sessions s JOIN weeks w ON w.id = s.week_id
       JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
       LEFT JOIN problems pr ON pr.id = s.problem_id
       WHERE s.interviewer_id = ?1 OR s.interviewee_id = ?1 ORDER BY w.idx, s.id`,
    ).bind(id).all<any>(),
    c.env.DB.prepare(
      `SELECT id, kind, session_id, deadline_at, submitted_at
       FROM form_instances WHERE assignee_id = ?1 ORDER BY session_id, id`,
    ).bind(id).all<{ id: number; kind: string; session_id: number; deadline_at: string; submitted_at: string | null }>(),
    c.env.DB.prepare(
      `SELECT i.*, reporter.name AS reporter_name FROM incidents i
       LEFT JOIN participants reporter ON reporter.id = i.reporter_id
       WHERE (i.accused_id = ?1 OR i.reporter_id = ?1) AND i.kind != 'issue' ORDER BY i.id DESC`,
    ).bind(id).all<any>(),
    c.env.DB.prepare(
      `SELECT a.*, actor.name AS actor_name FROM audit_log a LEFT JOIN participants actor ON actor.id = a.actor_participant_id
       WHERE a.target_type = 'participant' AND a.target_id = ?1 ORDER BY a.id DESC LIMIT 20`,
    ).bind(String(id)).all<any>(),
  ]);
  const secret = c.env.FORM_SIGNING_SECRET;
  const now = Date.now();
  const signedForms = await Promise.all(forms.results.map(async (form) => {
    const expiresAt = new Date(new Date(form.deadline_at).getTime() + 7 * 86400_000);
    return {
      ...form,
      url: secret && expiresAt.getTime() > now
        ? `/f/${await signToken(secret, `f:${form.id}`, expiresAt)}`
        : null,
    };
  }));
  const formsBySession = new Map<number, typeof signedForms>();
  for (const form of signedForms) {
    const current = formsBySession.get(form.session_id) ?? [];
    current.push(form);
    formsBySession.set(form.session_id, current);
  }
  const { resume_object_key: _resumeObjectKey, ...safeParticipant } = participant;
  return c.json({
    participant: { ...safeParticipant, resume: resumeSummary(participant) },
    sessions: sessions.results.map((session) => ({ ...session, forms: formsBySession.get(session.id) ?? [] })),
    incidents: incidents.results,
    audit: auditRows.results,
  });
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
  if (!cohort) return c.json({ cohort: null, weeks: [], selectedWeek: null, sessions: [], optins: [], participants: [], repairs: [] });
  const weeks = await cohortWeeks(c.env, cohort.id);
  const requested = Number(c.req.query('week'));
  const selectedWeek = weeks.find((week) => week.id === requested) ?? weeks.at(-1)!;
  const [sessions, optins, participants, repairs] = await Promise.all([
    c.env.DB.prepare(
      `SELECT s.*, pi.name AS interviewer_name, pe.name AS interviewee_name,
              p.number AS problem_number, p.title AS problem_title, p.difficulty AS problem_difficulty,
              (SELECT count(*) FROM form_instances f WHERE f.session_id = s.id AND f.submitted_at IS NOT NULL) AS reports_in
       FROM sessions s JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
       LEFT JOIN problems p ON p.id = s.problem_id WHERE s.week_id = ?1 ORDER BY s.id`,
    ).bind(selectedWeek.id).all<any>(),
    c.env.DB.prepare(
      `SELECT o.*, p.name, p.status FROM optins o JOIN participants p ON p.id = o.participant_id
       WHERE o.week_id = ?1 ORDER BY lower(p.name)`,
    ).bind(selectedWeek.id).all<any>(),
    c.env.DB.prepare(
      `SELECT id, name, discord_username FROM participants
       WHERE status = 'active' AND pairing_excluded = 0
       ORDER BY lower(name), id`,
    ).all<any>(),
    c.env.DB.prepare(
      `SELECT r.*, p.name FROM repair_queue r JOIN participants p ON p.id = r.participant_id
       WHERE r.week_id = ?1 ORDER BY r.state, r.id`,
    ).bind(selectedWeek.id).all<any>(),
  ]);
  return c.json({ cohort, weeks, selectedWeek, sessions: sessions.results, optins: optins.results, participants: participants.results, repairs: repairs.results });
});

adminApi.post('/api/admin/rounds/:weekId/extra-interviewer', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const weekId = Number(c.req.param('weekId'));
  const body = await c.req.json<{ participantId?: number; enabled?: boolean }>().catch(() => null);
  const participantId = Number(body?.participantId);
  if (!Number.isInteger(weekId) || !Number.isInteger(participantId) || typeof body?.enabled !== 'boolean') {
    return c.json({ error: 'invalid_request' }, 400);
  }
  const eligible = await c.env.DB.prepare(
    `SELECT p.id FROM participants p JOIN weeks w ON w.id = ?1 JOIN cohorts c ON c.id = w.cohort_id
     WHERE p.id = ?2 AND p.status = 'active' AND p.pairing_excluded = 0 AND c.status = 'active'`,
  ).bind(weekId, participantId).first<{ id: number }>();
  if (!eligible) return c.json({ error: 'not_found', message: 'That round or participant is not eligible for matching.' }, 404);

  if (body.enabled) {
    await c.env.DB.prepare(
      `INSERT INTO optins (week_id, participant_id, regular_opt_in, extra_interviewer)
       VALUES (?1, ?2, 0, 1)
       ON CONFLICT(week_id, participant_id) DO UPDATE SET extra_interviewer = 1`,
    ).bind(weekId, participantId).run();
  } else {
    const optin = await c.env.DB.prepare(
      'SELECT regular_opt_in FROM optins WHERE week_id = ?1 AND participant_id = ?2',
    ).bind(weekId, participantId).first<{ regular_opt_in: number }>();
    if (optin?.regular_opt_in === 1) {
      await c.env.DB.prepare(
        'UPDATE optins SET extra_interviewer = 0 WHERE week_id = ?1 AND participant_id = ?2',
      ).bind(weekId, participantId).run();
    } else if (optin) {
      await c.env.DB.prepare('DELETE FROM optins WHERE week_id = ?1 AND participant_id = ?2')
        .bind(weekId, participantId).run();
    }
  }
  await audit(c.env, gate.participantId, 'round.extra_interviewer_changed', 'participant', participantId, {
    weekId, enabled: body.enabled,
  });
  return c.json({ ok: true, enabled: body.enabled });
});

adminApi.get('/api/admin/reviews', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const { results } = await c.env.DB.prepare(
    `SELECT s.id, s.review_state, s.state, w.idx AS round, pi.name AS interviewer_name, pe.name AS interviewee_name,
            pe.id AS interviewee_id,
            (SELECT json_extract(f.payload, '$.video_url') FROM form_instances f
             WHERE f.session_id = s.id AND f.kind = 'interviewee_report' AND f.submitted_at IS NOT NULL
             ORDER BY f.id DESC LIMIT 1) AS video_url
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.review_state != 'none'
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
  return c.json(await problemBankWorkspace(c.env));
});

adminApi.put('/api/admin/problem-sets/:weekId', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  try {
    const body = await c.req.json<{ problemIds?: number[] }>().catch(() => null);
    if (!body || !Array.isArray(body.problemIds)) return c.json({ error: 'invalid_request' }, 400);
    const result = await replaceProblemSet(c.env, Number(c.req.param('weekId')), body.problemIds);
    await audit(c.env, gate.participantId, 'problem_set.replaced', 'week', result.weekId, { problemIds: result.problemIds });
    return c.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ProblemSetError) return c.json({ error: 'invalid_problem_set', message: error.message }, error.status);
    throw error;
  }
});

adminApi.post('/api/admin/problem-sets/:weekId/generate', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  try {
    const body = await c.req.json<{ size?: number }>().catch(() => null);
    const size = Number(body?.size ?? 5);
    const result = await generateProblemSet(c.env, Number(c.req.param('weekId')), size);
    await audit(c.env, gate.participantId, 'problem_set.generated', 'week', result.weekId, { size, chosen: result.chosen.map((row) => row.id) });
    return c.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ProblemSetError) return c.json({ error: 'invalid_problem_set', message: error.message }, error.status);
    throw error;
  }
});

adminApi.post('/api/admin/problems', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<any>().catch(() => null);
  const question = questionInput(body);
  if (!question) return c.json({ error: 'invalid_request', message: 'Title, statement Markdown, difficulty, and at least one available round are required.' }, 400);
  const result = await c.env.DB.prepare(
    `INSERT INTO problems
       (source, number, title, url, difficulty, difficulty_rank, content_md,
        available_weeks, statement_md, hints_md, solution_md, active)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`,
  ).bind(
    question.source, question.number, question.title, question.url, question.difficulty,
    question.difficultyRank, question.content, JSON.stringify(question.availableWeeks),
    question.sections.statement, question.sections.hints || null, question.sections.solution || null,
    question.active,
  ).run();
  const id = Number(result.meta.last_row_id);
  await audit(c.env, gate.participantId, 'problem.created', 'problem', id, { title: question.title, availableWeeks: question.availableWeeks });
  return c.json({ ok: true, id }, 201);
});

adminApi.post('/api/admin/problems/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  const body = await c.req.json<any>().catch(() => null);
  const question = questionInput(body);
  if (!Number.isInteger(id) || !question) return c.json({ error: 'invalid_request', message: 'Title, statement Markdown, difficulty, and at least one available round are required.' }, 400);
  const result = await c.env.DB.prepare(
    `UPDATE problems SET source = ?2, number = ?3, title = ?4, url = ?5,
       difficulty = ?6, difficulty_rank = ?7, content_md = ?8, available_weeks = ?9,
       statement_md = ?10, hints_md = ?11, solution_md = ?12, active = ?13 WHERE id = ?1`,
  ).bind(
    id, question.source, question.number, question.title, question.url, question.difficulty,
    question.difficultyRank, question.content, JSON.stringify(question.availableWeeks),
    question.sections.statement, question.sections.hints || null, question.sections.solution || null,
    question.active,
  ).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare(
    `DELETE FROM week_problem_sets
     WHERE problem_id = ?1 AND (?2 = 0 OR week_id IN (
       SELECT w.id FROM weeks w
       WHERE NOT EXISTS (SELECT 1 FROM json_each(?3) WHERE value = w.idx)
     ))`,
  ).bind(id, question.active, JSON.stringify(question.availableWeeks)).run();
  await audit(c.env, gate.participantId, 'problem.updated', 'problem', id, { title: question.title, availableWeeks: question.availableWeeks });
  return c.json({ ok: true });
});

function questionInput(body: any) {
  if (!body?.title?.trim() || !['easy', 'medium', 'hard'].includes(body.difficulty)) return null;
  const availableWeeks = normalizeAvailableWeeks(body.availableWeeks);
  const content = String(body.content ?? composeQuestionMarkdown({
    statement: body.statement,
    hints: body.hints,
    solution: body.solution,
  })).trim().slice(0, 100_000);
  const sections = parseQuestionMarkdown(content);
  if (!availableWeeks.length || !sections.statement) return null;
  const rawRank = body.difficultyRank == null ? null : Number(body.difficultyRank);
  return {
    source: String(body.source ?? 'manual').trim().slice(0, 50) || 'manual',
    number: body.number ? Number(body.number) : null,
    title: String(body.title).trim().slice(0, 200),
    url: String(body.url ?? '').trim().slice(0, 1000) || null,
    difficulty: body.difficulty as 'easy' | 'medium' | 'hard',
    difficultyRank: rawRank != null && Number.isFinite(rawRank) ? rawRank : null,
    content,
    availableWeeks,
    sections,
    active: body.active === false ? 0 : 1,
  };
}

adminApi.get('/api/admin/analytics', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const [participants, sessions, reports, reviews, problems, rounds] = await Promise.all([
    c.env.DB.prepare(
      `SELECT CASE WHEN pairing_excluded = 1 THEN 'organizer' ELSE status END AS status, count(*) AS value
       FROM participants GROUP BY CASE WHEN pairing_excluded = 1 THEN 'organizer' ELSE status END`,
    ).all<any>(),
    c.env.DB.prepare('SELECT state AS label, count(*) AS value FROM sessions GROUP BY state').all<any>(),
    c.env.DB.prepare(`SELECT kind AS label, count(*) AS total, sum(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted FROM form_instances GROUP BY kind`).all<any>(),
    c.env.DB.prepare(`SELECT review_state AS label, count(*) AS value FROM sessions WHERE review_state != 'none' GROUP BY review_state`).all<any>(),
    c.env.DB.prepare(
      `SELECT p.id, p.title, p.difficulty, count(s.id) AS uses,
              avg(CAST(json_extract(f.payload, '$.rating_experience') AS REAL)) AS avg_experience
       FROM problems p LEFT JOIN sessions s ON s.problem_id = p.id
       LEFT JOIN form_instances f ON f.session_id = s.id AND f.kind = 'interviewee_report' AND f.submitted_at IS NOT NULL
       GROUP BY p.id ORDER BY uses DESC, p.title LIMIT 20`,
    ).all<any>(),
    c.env.DB.prepare(
      `SELECT c.name AS cohort, w.idx AS round,
              (SELECT count(DISTINCT o.participant_id) FROM optins o WHERE o.week_id = w.id) AS optins,
              (SELECT count(*) FROM sessions s WHERE s.week_id = w.id) AS sessions,
              (SELECT count(*) FROM sessions s WHERE s.week_id = w.id AND s.state = 'completed') AS completed
       FROM weeks w JOIN cohorts c ON c.id = w.cohort_id
       ORDER BY c.id, w.idx`,
    ).all<any>(),
  ]);
  return c.json({ participants: participants.results, sessions: sessions.results, reports: reports.results, reviews: reviews.results, problems: problems.results, rounds: rounds.results });
});

adminApi.get('/api/admin/operations', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const [outbox, notifications, jobs, auditRows, enrollment] = await Promise.all([
    c.env.DB.prepare(
      `SELECT o.id, o.kind, o.payload, o.attempts, o.run_after, o.done_at, o.dismissed_at, o.last_error, o.created_at,
              (SELECT p.name FROM participants p
               WHERE p.discord_id = json_extract(o.payload, '$.userId')
                  OR lower(p.preferred_email) = lower(json_extract(o.payload, '$.to'))
               LIMIT 1) AS participant_name
       FROM outbox o ORDER BY o.id DESC LIMIT 100`,
    ).all<any>(),
    c.env.DB.prepare(`SELECT n.*, p.name FROM notify_log n LEFT JOIN participants p ON p.id = n.participant_id ORDER BY n.id DESC LIMIT 100`).all<any>(),
    c.env.DB.prepare('SELECT * FROM job_runs ORDER BY ran_at DESC LIMIT 100').all<any>(),
    c.env.DB.prepare(`SELECT a.*, p.name AS actor_name FROM audit_log a LEFT JOIN participants p ON p.id = a.actor_participant_id ORDER BY a.id DESC LIMIT 100`).all<any>(),
    enrollmentFunnel(c.env),
  ]);
  const lastTick = jobs.results.find((row) => String(row.job_key).startsWith('tick:')) ?? null;
  const ageMinutes = lastTick ? Math.max(0, Math.round((Date.now() - new Date(lastTick.ran_at).getTime()) / 60_000)) : null;
  const cron = {
    status: !lastTick ? 'never_run' : ageMinutes! <= 30 ? 'healthy' : 'late',
    lastTickAt: lastTick?.ran_at ?? null,
    ageMinutes,
    expectedEveryMinutes: 15,
  };
  return c.json({ outbox: outbox.results, notifications: notifications.results, jobs: jobs.results, audit: auditRows.results, cron, enrollmentFunnel: enrollment });
});

adminApi.post('/api/admin/operations/outbox/:id/retry', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  const result = await c.env.DB.prepare(
    `UPDATE outbox SET attempts = 0, last_error = NULL, dismissed_at = NULL, run_after = ?2 WHERE id = ?1 AND done_at IS NULL`,
  ).bind(id, new Date().toISOString()).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  await audit(c.env, gate.participantId, 'outbox.retry', 'outbox', id);
  return c.json({ ok: true });
});

adminApi.post('/api/admin/operations/outbox/:id/dismiss', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  const dismissedAt = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE outbox SET dismissed_at = ?2
     WHERE id = ?1 AND dismissed_at IS NULL AND done_at IS NULL AND attempts >= 5`,
  ).bind(id, dismissedAt).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  await audit(c.env, gate.participantId, 'outbox.dismiss', 'outbox', id);
  return c.json({ ok: true, dismissedAt });
});

adminApi.get('/api/admin/settings', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const keys = [...editableSettingKeys];
  const [settings, cohorts, rosterSize] = await Promise.all([
    getSettings(c.env, keys),
    c.env.DB.prepare('SELECT * FROM cohorts ORDER BY id DESC').all<any>(),
    count(c.env, "SELECT count(*) AS n FROM participants WHERE status = 'active' AND pairing_excluded = 0"),
  ]);
  const active = cohorts.results.find((cohort) => cohort.status === 'active');
  return c.json({
    settings,
    cohorts: cohorts.results,
    timeline: active ? programTimeline(active.start_date) : [],
    programWeek: active ? currentProgramPhase(active) : null,
    activeParticipants: rosterSize,
    minimumMatchingPool: 3,
  });
});

adminApi.get('/api/admin/api-tokens', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const { results } = await c.env.DB.prepare(
    `SELECT id, name, token_prefix, scopes, expires_at, last_used_at, revoked_at, created_at
     FROM admin_api_tokens WHERE actor_participant_id = ?1
     ORDER BY id DESC`,
  ).bind(gate.participantId).all<any>();
  return c.json({
    scopes: ADMIN_SCOPES,
    tokens: results.map((row) => ({ ...row, scopes: safeJsonList(row.scopes) })),
  });
});

adminApi.get('/api/admin/mcp-token', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  c.header('Cache-Control', 'private, no-store');
  const row = await c.env.DB.prepare(
    `SELECT id, token_ciphertext, token_prefix, scopes, last_used_at, created_at
     FROM admin_api_tokens
     WHERE actor_participant_id = ?1 AND purpose = 'personal_mcp' AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > ?2)
     ORDER BY id DESC LIMIT 1`,
  ).bind(gate.participantId, new Date().toISOString()).first<{
    id: number; token_ciphertext: string; token_prefix: string; scopes: string; last_used_at: string | null; created_at: string;
  }>();
  const origin = (c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin).replace(/\/$/, '');
  return c.json({
    mcpUrl: `${origin}/mcp`,
    token: row ? await decryptAdminToken(c.env, row.token_ciphertext) : null,
    credential: row ? {
      id: row.id,
      tokenPrefix: row.token_prefix,
      scopes: safeJsonList(row.scopes),
      lastUsedAt: row.last_used_at,
      createdAt: row.created_at,
    } : null,
  });
});

adminApi.post('/api/admin/mcp-token/reset', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  c.header('Cache-Control', 'private, no-store');
  const created = await createAdminToken(
    c.env,
    gate.participantId,
    PERSONAL_MCP_TOKEN_NAME,
    PERSONAL_MCP_TOKEN_SCOPES,
    null,
    'personal_mcp',
  );
  const revokedAt = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE admin_api_tokens SET revoked_at = ?3
     WHERE actor_participant_id = ?1 AND purpose = 'personal_mcp'
       AND id != ?2 AND revoked_at IS NULL`,
  ).bind(gate.participantId, created.id, revokedAt).run();
  await audit(c.env, gate.participantId, 'mcp_token.reset', 'api_token', created.id, {
    scopes: PERSONAL_MCP_TOKEN_SCOPES,
  });
  const origin = (c.env.PUBLIC_ORIGIN || new URL(c.req.url).origin).replace(/\/$/, '');
  return c.json({
    ok: true,
    mcpUrl: `${origin}/mcp`,
    token: created.token,
    credential: {
      id: created.id,
      tokenPrefix: created.prefix,
      scopes: PERSONAL_MCP_TOKEN_SCOPES,
      lastUsedAt: null,
      createdAt: revokedAt,
    },
  }, 201);
});

adminApi.post('/api/admin/api-tokens', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ name?: string; scopes?: string[]; expiresInDays?: number | null }>().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const scopes = normalizeAdminScopes(body?.scopes);
  const days = body?.expiresInDays == null ? null : Number(body.expiresInDays);
  if (!name || name.length > 80 || !scopes || (days != null && (!Number.isInteger(days) || days < 1 || days > 365))) {
    return c.json({ error: 'invalid_request', message: 'Choose a name, valid scopes, and an expiry up to 365 days.' }, 400);
  }
  const expiresAt = days == null ? null : new Date(Date.now() + days * 86400_000).toISOString();
  const created = await createAdminToken(c.env, gate.participantId, name, scopes, expiresAt);
  await audit(c.env, gate.participantId, 'api_token.created', 'api_token', created.id, { name, scopes, expiresAt });
  return c.json({ ok: true, ...created, name, scopes, expiresAt }, 201);
});

adminApi.delete('/api/admin/api-tokens/:id', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const id = Number(c.req.param('id'));
  if (!Number.isInteger(id)) return c.json({ error: 'invalid_id' }, 400);
  const revokedAt = new Date().toISOString();
  const result = await c.env.DB.prepare(
    `UPDATE admin_api_tokens SET revoked_at = ?3
     WHERE id = ?1 AND actor_participant_id = ?2 AND revoked_at IS NULL`,
  ).bind(id, gate.participantId, revokedAt).run();
  if (!result.meta.changes) return c.json({ error: 'not_found' }, 404);
  await audit(c.env, gate.participantId, 'api_token.revoked', 'api_token', id);
  return c.json({ ok: true, revokedAt });
});

adminApi.post('/api/admin/settings', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ settings?: Record<string, string> }>().catch(() => null);
  if (!body?.settings || typeof body.settings !== 'object') return c.json({ error: 'invalid_request' }, 400);
  const entries = Object.entries(body.settings).filter(([key]) => editableSettingKeys.has(key as SettingKey));
  const packetLead = entries.find(([key]) => key === 'packet_lead_hours')?.[1];
  if (packetLead !== undefined && !packetLeadOptions.has(String(packetLead).trim())) {
    return c.json({ error: 'invalid_packet_lead', message: 'Choose a supported packet delivery time.' }, 400);
  }
  for (const [key, value] of entries) await setSetting(c.env, key as SettingKey, String(value).trim().slice(0, 200));
  await audit(c.env, gate.participantId, 'program.settings_updated', 'settings', undefined, Object.fromEntries(entries));
  return c.json({ ok: true, updated: entries.length });
});

function safeJsonList(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

adminApi.post('/api/admin/cohorts', async (c) => {
  const gate = await requireOrganizer(c);
  if (gate instanceof Response) return gate;
  const body = await c.req.json<{ name?: string; startDate?: string; rounds?: number }>().catch(() => null);
  const match = body?.startDate?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const rounds = Number(body?.rounds ?? 3);
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  const validDate = Boolean(date && date.getUTCFullYear() === Number(match![1]) && date.getUTCMonth() === Number(match![2]) - 1 && date.getUTCDate() === Number(match![3]));
  if (!body?.name?.trim() || !match || !validDate || !Number.isInteger(rounds) || rounds < 1 || rounds > 8) return c.json({ error: 'invalid_request' }, 400);
  const created = await createCohort(c.env, body.name.trim().slice(0, 100), [Number(match[1]), Number(match[2]), Number(match[3])], rounds);
  await audit(c.env, gate.participantId, 'cohort.created', 'cohort', created.cohortId, { name: body.name, startDate: body.startDate, rounds });
  return c.json({ ok: true, ...created }, 201);
});
