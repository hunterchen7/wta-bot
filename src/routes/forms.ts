import { Hono } from 'hono';
import { onReportSubmitted } from '../engine/reports';
import type { Env } from '../env';
import { fieldsFor, validate, type Field } from '../forms/schema';
import { verifyFormToken, verifyToken } from '../forms/token';
import { sessionFrom } from './web';
import { isCurrentOrganizer } from '../organizers';
import { fizzBuzzDemoPacket } from '../demo/fizzbuzz-packet';
import { createPairyQuestionPack, pairyQuestionPackFilename } from '../pairy-question-pack';
import { effectiveInterviewerNotes, effectiveProblemExecution } from '../problem-authoring';
import { readAvailableWeeks } from '../question-markdown';

// Signed report and problem links now hydrate React pages. This module exposes
// data and mutations only; it intentionally contains no HTML rendering.
export const forms = new Hono<{ Bindings: Env }>();

type LoadedInstance = {
  id: number; kind: string; session_id: number; assignee_id: number;
  deadline_at: string; submitted_at: string | null; payload: string | null;
  week_idx: number; scheduled_at: string | null; problem_id: number | null;
  interviewer_name: string | null; interviewee_name: string | null;
  interviewer_id: number; interviewee_id: number; assignee_name: string | null;
  assignee_discord_id: string; assignee_discord_username: string | null;
  assignee_discord_nickname: string | null;
};

async function loadInstance(env: Env, token: string): Promise<LoadedInstance | null> {
  if (!env.FORM_SIGNING_SECRET) return null;
  const verified = await verifyFormToken(env.FORM_SIGNING_SECRET, token);
  if (!verified) return null;
  return env.DB.prepare(
    `SELECT f.id, f.kind, f.session_id, f.assignee_id, f.deadline_at, f.submitted_at, f.payload,
            w.idx AS week_idx, s.scheduled_at, s.problem_id, s.interviewer_id, s.interviewee_id,
            pi.name AS interviewer_name, pe.name AS interviewee_name, pa.name AS assignee_name,
            pa.discord_id AS assignee_discord_id,
            pa.discord_username AS assignee_discord_username,
            pa.discord_nickname AS assignee_discord_nickname
     FROM form_instances f JOIN sessions s ON s.id = f.session_id JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
     JOIN participants pa ON pa.id = f.assignee_id WHERE f.id = ?1`,
  ).bind(verified.instanceId).first<LoadedInstance>();
}

async function dynamicFields(env: Env, instance: LoadedInstance): Promise<Field[] | null> {
  const base = fieldsFor(instance.kind);
  if (!base || instance.kind !== 'interviewer_report') return base;
  const assigned = instance.problem_id
    ? await env.DB.prepare('SELECT id, title, number FROM problems WHERE id = ?1')
      .bind(instance.problem_id).first<{ id: number; title: string; number: number | null }>()
    : null;
  const { results } = assigned
    ? await env.DB.prepare(
      `SELECT p.id, p.title, p.number FROM week_problem_sets wps JOIN problems p ON p.id = wps.problem_id
       WHERE wps.week_id = (SELECT week_id FROM sessions WHERE id = ?1)
       ORDER BY CASE WHEN p.id = ?2 THEN 0 ELSE 1 END, p.id`,
    ).bind(instance.session_id, assigned.id).all<{ id: number; title: string; number: number | null }>()
    : await env.DB.prepare(
      `SELECT p.id, p.title, p.number FROM week_problem_sets wps JOIN problems p ON p.id = wps.problem_id
       WHERE wps.week_id = (SELECT week_id FROM sessions WHERE id = ?1)
         AND NOT EXISTS (
           SELECT 1 FROM exposures e
           WHERE e.problem_id = p.id AND e.participant_id IN (?2, ?3)
         )
         AND NOT EXISTS (
           SELECT 1 FROM sessions seen
           WHERE seen.problem_id = p.id
             AND (seen.interviewer_id IN (?2, ?3) OR seen.interviewee_id IN (?2, ?3))
         )
       ORDER BY p.id`,
    ).bind(instance.session_id, instance.interviewer_id, instance.interviewee_id).all<{ id: number; title: string; number: number | null }>();
  if (assigned && !results.some((problem) => problem.id === assigned.id)) results.unshift(assigned);
  if (!results.length) return base;
  const picker: Field = {
    id: 'problem_used', label: 'Which interview question did you choose?', type: 'select', required: true,
    options: results.map((problem) => ({ value: String(problem.id), label: `${problem.number ? `#${problem.number} ` : ''}${problem.title}` })),
    help: assigned
      ? 'Pre-filled with the problem assigned to this session. Change it only if you used a different problem.'
      : 'Choose the problem you actually used. Your interviewee receives its solution notes after submitting.',
  };
  return [...base.slice(0, 4), picker, ...base.slice(4)];
}

forms.get('/api/forms/:token', async (c) => {
  if (!c.env.FORM_SIGNING_SECRET) return c.json({ error: 'not_configured', message: 'Report forms are not configured.' }, 503);
  const instance = await loadInstance(c.env, c.req.param('token'));
  if (!instance) return c.json({ error: 'invalid_link', message: 'This report link is invalid or expired.' }, 404);
  const fields = await dynamicFields(c.env, instance);
  if (!fields) return c.json({ error: 'unknown_form', message: 'This report type is not supported.' }, 400);
  return c.json(reportPayload(instance, fields));
});

forms.post('/api/forms/:token', async (c) => {
  if (!c.env.FORM_SIGNING_SECRET) return c.json({ error: 'not_configured', message: 'Report forms are not configured.' }, 503);
  const instance = await loadInstance(c.env, c.req.param('token'));
  if (!instance) return c.json({ error: 'invalid_link', message: 'This report link is invalid or expired.' }, 404);
  const fields = await dynamicFields(c.env, instance);
  if (!fields) return c.json({ error: 'unknown_form', message: 'This report type is not supported.' }, 400);
  const body = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!body) return c.json({ error: 'invalid_json', message: 'The report could not be read.' }, 400);
  const result = validate(fields, body);
  if (!result.ok) {
    return c.json({ error: 'invalid_report', message: 'Check the highlighted fields.', fieldErrors: result.fieldErrors, errors: result.errors }, 400);
  }
  const recordingUrl = result.payload.video_url;
  if (instance.kind === 'interviewee_report' && recordingUrl) {
    const parsed = safeUrl(recordingUrl, c.req.url);
    if (!parsed) return c.json({
      error: 'invalid_report', message: 'Check the highlighted fields.',
      fieldErrors: { video_url: 'Enter a complete http:// or https:// link.' },
      errors: ['Add your session recording: Enter a complete link.'],
    }, 400);
    const internal = parsed.origin === new URL(c.req.url).origin && /^\/api\/recordings\/(\d+)$/.exec(parsed.pathname);
    if (internal) {
      const owned = await c.env.DB.prepare(
        "SELECT id FROM recording_assets WHERE id = ?1 AND form_instance_id = ?2 AND status = 'uploaded' AND cleanup_started_at IS NULL",
      ).bind(Number(internal[1]), instance.id).first<{ id: number }>();
      if (!owned) return c.json({
        error: 'invalid_report', message: 'Check the highlighted fields.',
        fieldErrors: { video_url: 'This uploaded recording is unavailable. Upload it again or use a recording link.' },
        errors: ['Add your session recording: This uploaded recording is unavailable.'],
      }, 400);
    }
  }
  if (new Date() > new Date(instance.deadline_at)) result.payload._late = 'true';

  if (instance.kind === 'interviewer_report' && result.payload.problem_used) {
    await c.env.DB.prepare('UPDATE sessions SET problem_id = ?1 WHERE id = ?2 AND problem_id IS NULL')
      .bind(Number(result.payload.problem_used), instance.session_id).run();
    await c.env.DB.prepare(
      `INSERT INTO exposures (participant_id, problem_id, role, session_id)
       SELECT interviewer_id, problem_id, 'interviewer', id FROM sessions
       WHERE id = ?1 AND problem_id IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM exposures e WHERE e.session_id = ?1 AND e.role = 'interviewer')`,
    ).bind(instance.session_id).run();
  }

  const firstSubmission = instance.submitted_at === null;
  const submittedAt = new Date().toISOString();
  await c.env.DB.prepare('UPDATE form_instances SET payload = ?2, submitted_at = ?3 WHERE id = ?1')
    .bind(instance.id, JSON.stringify(result.payload), submittedAt).run();
  if (firstSubmission) await onReportSubmitted(c.env, instance as any, result.payload, new URL(c.req.url).origin);
  return c.json({ ok: true, submittedAt, message: firstSubmission ? 'Report submitted.' : 'Report updated.' });
});

const MAX_RECORDING_BYTES = 2 * 1024 * 1024 * 1024;
const RECORDING_PART_BYTES = 16 * 1024 * 1024;

forms.post('/api/forms/:token/recording/init', async (c) => {
  if (!c.env.RECORDINGS) return c.json({ error: 'recordings_not_configured', message: 'Direct recording uploads are not configured yet.' }, 503);
  const instance = await loadInstance(c.env, c.req.param('token'));
  if (!instance || instance.kind !== 'interviewee_report') return c.json({ error: 'invalid_link', message: 'This recording upload link is invalid or expired.' }, 404);
  const body = await c.req.json<{ filename?: string; size?: number; contentType?: string }>().catch(() => null);
  const size = Number(body?.size ?? 0);
  const contentType = String(body?.contentType ?? '').slice(0, 100);
  if (!body?.filename || !Number.isFinite(size) || size <= 0 || size > MAX_RECORDING_BYTES || !contentType.startsWith('video/')) {
    return c.json({ error: 'invalid_recording', message: 'Choose a supported video no larger than 2 GB.' }, 400);
  }
  const objectKey = `sessions/${instance.session_id}/recording-${crypto.randomUUID()}${recordingExtension(contentType)}`;
  const upload = await c.env.RECORDINGS.createMultipartUpload(objectKey, { httpMetadata: { contentType, cacheControl: 'private, no-store' } });
  const result = await c.env.DB.prepare(
    `INSERT INTO recording_assets
       (form_instance_id, session_id, participant_id, object_key, upload_id, original_filename, content_type, original_bytes)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  ).bind(instance.id, instance.session_id, instance.assignee_id, objectKey, upload.uploadId, String(body.filename).slice(0, 255), contentType, size).run();
  return c.json({ id: Number(result.meta.last_row_id), partSize: RECORDING_PART_BYTES });
});

forms.put('/api/forms/:token/recording/:id/part/:part', async (c) => {
  if (!c.env.RECORDINGS) return c.json({ error: 'recordings_not_configured' }, 503);
  const instance = await loadInstance(c.env, c.req.param('token'));
  const asset = instance ? await recordingAsset(c.env, Number(c.req.param('id')), instance.id) : null;
  const partNumber = Number(c.req.param('part'));
  const contentLength = Number(c.req.header('content-length') ?? 0);
  if (!asset || asset.status !== 'pending' || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return c.json({ error: 'invalid_upload' }, 404);
  if (!c.req.raw.body || contentLength <= 0 || contentLength > RECORDING_PART_BYTES) return c.json({ error: 'invalid_part' }, 400);
  const upload = c.env.RECORDINGS.resumeMultipartUpload(asset.object_key, asset.upload_id);
  const part = await upload.uploadPart(partNumber, c.req.raw.body);
  return c.json({ partNumber: part.partNumber, etag: part.etag });
});

forms.post('/api/forms/:token/recording/:id/complete', async (c) => {
  if (!c.env.RECORDINGS) return c.json({ error: 'recordings_not_configured' }, 503);
  const instance = await loadInstance(c.env, c.req.param('token'));
  const asset = instance ? await recordingAsset(c.env, Number(c.req.param('id')), instance.id) : null;
  const body = await c.req.json<{ parts?: Array<{ partNumber: number; etag: string }> }>().catch(() => null);
  if (!asset || asset.status !== 'pending' || !body?.parts?.length) return c.json({ error: 'invalid_upload' }, 404);
  const parts = body.parts
    .filter((part) => Number.isInteger(part.partNumber) && part.partNumber > 0 && typeof part.etag === 'string')
    .sort((a, b) => a.partNumber - b.partNumber);
  if (parts.length !== body.parts.length) return c.json({ error: 'invalid_parts' }, 400);
  const upload = c.env.RECORDINGS.resumeMultipartUpload(asset.object_key, asset.upload_id);
  const object = await upload.complete(parts);
  const storedBytes = object.size;
  await c.env.DB.prepare(
    `UPDATE recording_assets SET status = 'uploaded', stored_bytes = ?2, completed_at = ?3 WHERE id = ?1`,
  ).bind(asset.id, storedBytes, new Date().toISOString()).run();
  return c.json({ ok: true, id: asset.id, url: `${new URL(c.req.url).origin}/api/recordings/${asset.id}`, storedBytes });
});

forms.delete('/api/forms/:token/recording/:id', async (c) => {
  if (!c.env.RECORDINGS) return c.json({ ok: true });
  const instance = await loadInstance(c.env, c.req.param('token'));
  const asset = instance ? await recordingAsset(c.env, Number(c.req.param('id')), instance.id) : null;
  if (!asset || asset.status !== 'pending') return c.json({ ok: true });
  await c.env.RECORDINGS.resumeMultipartUpload(asset.object_key, asset.upload_id).abort().catch(() => {});
  await c.env.DB.prepare("UPDATE recording_assets SET status = 'aborted' WHERE id = ?1").bind(asset.id).run();
  return c.json({ ok: true });
});

forms.get('/api/recordings/:id', async (c) => {
  if (!c.env.RECORDINGS) return c.json({ error: 'recordings_not_configured' }, 503);
  const session = await sessionFrom(c);
  if (!session?.organizer || !(await isCurrentOrganizer(c.env, session.participantId))) {
    return c.json({ error: 'forbidden' }, session ? 403 : 401);
  }
  const asset = await c.env.DB.prepare(
    "SELECT object_key FROM recording_assets WHERE id = ?1 AND status = 'uploaded' AND cleanup_started_at IS NULL",
  ).bind(Number(c.req.param('id'))).first<{ object_key: string }>();
  if (!asset) return c.json({ error: 'not_found' }, 404);
  const requestedRange = Boolean(c.req.header('range'));
  const object = await c.env.RECORDINGS.get(
    asset.object_key,
    requestedRange ? { range: c.req.raw.headers } : undefined,
  );
  if (!object) return c.json({ error: 'not_found' }, 404);
  const headers = new Headers({ 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', ETag: object.httpEtag });
  object.writeHttpMetadata(headers);
  let status: 200 | 206 = 200;
  if (requestedRange && object.range && 'offset' in object.range && typeof object.range.offset === 'number' && typeof object.range.length === 'number') {
    status = 206;
    headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
    headers.set('Content-Length', String(object.range.length));
  } else {
    headers.set('Content-Length', String(object.size));
  }
  return new Response(object.body, { status, headers });
});

forms.get('/api/problems/:token', async (c) => {
  if (!c.env.FORM_SIGNING_SECRET) return c.json({ error: 'not_configured', message: 'Problem links are not configured.' }, 503);
  const verified = await verifyToken(c.env.FORM_SIGNING_SECRET, c.req.param('token'));
  if (verified?.subject === 'demo:fizzbuzz') return c.json(fizzBuzzDemoPacket);

  // Organizer self-preview (pp:<problemId>): the full interviewer packet for one
  // problem with no session context — powers the "DM me a sample packet" action.
  const previewMatch = verified && /^pp:(\d+)$/.exec(verified.subject);
  if (previewMatch) {
    const p = await c.env.DB.prepare(
      `SELECT number, title, url, difficulty, statement_md, solution_md, hints_md, interviewer_notes_md
       FROM problems WHERE id = ?1`,
    ).bind(Number(previewMatch[1])).first<any>();
    if (!p) return c.json({ error: 'not_found', message: 'This problem no longer exists.' }, 404);
    return c.json({
      mode: 'packet', preview: true, round: null, scheduledAt: null, intervieweeName: null,
      problem: {
        number: p.number, title: p.title, url: p.url, difficulty: p.difficulty,
        statement: p.statement_md, notes: effectiveInterviewerNotes(p), hints: p.hints_md, solution: p.solution_md,
      },
    });
  }

  const match = verified && /^(p|sol):(\d+)$/.exec(verified.subject);
  if (!match) return c.json({ error: 'invalid_link', message: 'This problem link is invalid or expired.' }, 404);
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.scheduled_at, w.idx AS week_idx, p.number, p.title, p.url, p.difficulty,
            p.statement_md, p.solution_md, p.hints_md, p.interviewer_notes_md, pe.name AS interviewee_name
     FROM sessions s JOIN weeks w ON w.id = s.week_id JOIN problems p ON p.id = s.problem_id
     JOIN participants pe ON pe.id = s.interviewee_id WHERE s.id = ?1`,
  ).bind(Number(match[2])).first<any>();
  if (!row) return c.json({ error: 'not_found', message: 'No problem is assigned to this session yet.' }, 404);
  const packet = match[1] === 'p';
  return c.json({
    mode: packet ? 'packet' : 'solution', round: row.week_idx, scheduledAt: row.scheduled_at,
    intervieweeName: packet ? row.interviewee_name : null,
    problem: {
      number: row.number, title: row.title, url: row.url, difficulty: row.difficulty,
      statement: row.statement_md,
      notes: packet ? effectiveInterviewerNotes(row) : null,
      hints: packet ? row.hints_md : null,
      solution: row.solution_md,
    },
  });
});

forms.get('/api/problems/:token/pairy-pack', async (c) => {
  // Pairy fetches this endpoint cross-origin. Apply these to failures too so
  // callers can distinguish an expired link from a generic network error.
  c.header('Cache-Control', 'private, no-store');
  c.header('Access-Control-Allow-Origin', '*');
  c.header('Access-Control-Expose-Headers', 'Content-Disposition');
  if (!c.env.FORM_SIGNING_SECRET) {
    return c.json({ error: 'not_configured', message: 'Problem links are not configured.' }, 503);
  }
  const verified = await verifyToken(c.env.FORM_SIGNING_SECRET, c.req.param('token'));
  // The downloadable pack contains the private hint ladder and solution, so only
  // an interviewer packet token may reach it. Solution and demo links stay out.
  const match = verified && /^p:(\d+)$/.exec(verified.subject);
  if (!match) {
    return c.json({ error: 'invalid_link', message: 'This problem link is invalid or expired.' }, 404);
  }
  const row = await c.env.DB.prepare(
    `SELECT p.id, p.portable_id, p.source, p.number, p.title, p.url, p.difficulty,
            p.statement_md, p.solution_md, p.hints_md, p.interviewer_notes_md,
            p.execution_json, p.available_weeks
     FROM sessions s JOIN problems p ON p.id = s.problem_id
     WHERE s.id = ?1`,
  ).bind(Number(match[1])).first<{
    id: number;
    portable_id: string | null;
    source: string;
    number: number | null;
    title: string;
    url: string | null;
    difficulty: 'easy' | 'medium' | 'hard';
    statement_md: string | null;
    solution_md: string | null;
    hints_md: string | null;
    interviewer_notes_md: string | null;
    execution_json: string | null;
    available_weeks: string | null;
  }>();
  if (!row) {
    return c.json({ error: 'not_found', message: 'No problem is assigned to this session yet.' }, 404);
  }
  if (!row.statement_md?.trim()) {
    return c.json({ error: 'not_exportable', message: 'This problem needs a statement before it can be exported.' }, 409);
  }

  const pack = await createPairyQuestionPack({
    portableId: row.portable_id ?? `legacy-${row.id}`,
    title: row.title,
    difficulty: row.difficulty,
    promptMarkdown: row.statement_md,
    interviewerNotesMarkdown: effectiveInterviewerNotes(row),
    execution: effectiveProblemExecution(row),
    source: row.source,
    sourceNumber: row.number,
    sourceUrl: row.url,
    availableRounds: readAvailableWeeks(row.available_weeks),
  });
  c.header('Content-Type', 'application/vnd.pairy.question-pack+json; charset=utf-8');
  c.header(
    'Content-Disposition',
    `attachment; filename="${pairyQuestionPackFilename(row.title)}"`,
  );
  return c.body(`${JSON.stringify(pack, null, 2)}\n`);
});

function reportPayload(instance: LoadedInstance, fields: Field[]) {
  const isInterviewer = instance.kind === 'interviewer_report';
  const savedValues: Record<string, string> = instance.payload ? JSON.parse(instance.payload) : {};
  const values = isInterviewer && instance.problem_id && !savedValues.problem_used
    ? { ...savedValues, problem_used: String(instance.problem_id) }
    : savedValues;
  return {
    id: instance.id,
    kind: instance.kind,
    round: instance.week_idx,
    role: isInterviewer ? 'interviewer' : 'interviewee',
    assigneeName: instance.assignee_name,
    assigneeDiscordId: instance.assignee_discord_id,
    assigneeDiscordUsername: instance.assignee_discord_username,
    assigneeDiscordNickname: instance.assignee_discord_nickname,
    partnerName: isInterviewer ? instance.interviewee_name : instance.interviewer_name,
    scheduledAt: instance.scheduled_at,
    deadlineAt: instance.deadline_at,
    submittedAt: instance.submitted_at,
    overdue: !instance.submitted_at && new Date() > new Date(instance.deadline_at),
    fields,
    values,
  };
}

function recordingAsset(env: Env, id: number, formInstanceId: number) {
  return env.DB.prepare(
    'SELECT id, object_key, upload_id, status FROM recording_assets WHERE id = ?1 AND form_instance_id = ?2',
  ).bind(id, formInstanceId).first<{ id: number; object_key: string; upload_id: string; status: string }>();
}

function recordingExtension(contentType: string) {
  if (contentType === 'video/webm') return '.webm';
  if (contentType === 'video/quicktime') return '.mov';
  if (contentType === 'video/x-matroska' || contentType === 'video/matroska') return '.mkv';
  return '.mp4';
}

function safeUrl(value: string, base: string) {
  try { return new URL(value, base); } catch { return null; }
}
