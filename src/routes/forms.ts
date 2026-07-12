import { Hono } from 'hono';
import { onReportSubmitted } from '../engine/reports';
import type { Env } from '../env';
import { fieldsFor, validate, type Field } from '../forms/schema';
import { verifyFormToken, verifyToken } from '../forms/token';

// Signed report and problem links now hydrate React pages. This module exposes
// data and mutations only; it intentionally contains no HTML rendering.
export const forms = new Hono<{ Bindings: Env }>();

type LoadedInstance = {
  id: number; kind: string; session_id: number; assignee_id: number;
  deadline_at: string; submitted_at: string | null; payload: string | null;
  week_idx: number; scheduled_at: string | null;
  interviewer_name: string | null; interviewee_name: string | null;
  interviewer_id: number; interviewee_id: number; assignee_name: string | null;
};

async function loadInstance(env: Env, token: string): Promise<LoadedInstance | null> {
  if (!env.FORM_SIGNING_SECRET) return null;
  const verified = await verifyFormToken(env.FORM_SIGNING_SECRET, token);
  if (!verified) return null;
  return env.DB.prepare(
    `SELECT f.id, f.kind, f.session_id, f.assignee_id, f.deadline_at, f.submitted_at, f.payload,
            w.idx AS week_idx, s.scheduled_at, s.interviewer_id, s.interviewee_id,
            pi.name AS interviewer_name, pe.name AS interviewee_name, pa.name AS assignee_name
     FROM form_instances f JOIN sessions s ON s.id = f.session_id JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
     JOIN participants pa ON pa.id = f.assignee_id WHERE f.id = ?1`,
  ).bind(verified.instanceId).first<LoadedInstance>();
}

async function dynamicFields(env: Env, instance: LoadedInstance): Promise<Field[] | null> {
  const base = fieldsFor(instance.kind);
  if (!base || instance.kind !== 'interviewer_report') return base;
  const assigned = await env.DB.prepare('SELECT problem_id FROM sessions WHERE id = ?1')
    .bind(instance.session_id).first<{ problem_id: number | null }>();
  if (assigned?.problem_id) return base;
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.number FROM week_problem_sets wps JOIN problems p ON p.id = wps.problem_id
     WHERE wps.week_id = (SELECT week_id FROM sessions WHERE id = ?1) ORDER BY p.id`,
  ).bind(instance.session_id).all<{ id: number; title: string; number: number | null }>();
  if (!results.length) return base;
  const picker: Field = {
    id: 'problem_used', label: 'Which problem from the bank did you use?', type: 'select', required: true,
    options: results.map((problem) => ({ value: String(problem.id), label: `${problem.number ? `#${problem.number} ` : ''}${problem.title}` })),
    help: "Choose the problem you actually used. Your interviewee receives its solution notes after submitting.",
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

forms.get('/api/problems/:token', async (c) => {
  if (!c.env.FORM_SIGNING_SECRET) return c.json({ error: 'not_configured', message: 'Problem links are not configured.' }, 503);
  const verified = await verifyToken(c.env.FORM_SIGNING_SECRET, c.req.param('token'));
  const match = verified && /^(p|sol):(\d+)$/.exec(verified.subject);
  if (!match) return c.json({ error: 'invalid_link', message: 'This problem link is invalid or expired.' }, 404);
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.scheduled_at, w.idx AS week_idx, p.number, p.title, p.url, p.difficulty,
            p.statement_md, p.solution_md, p.hints_md, pe.name AS interviewee_name
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
      statement: row.statement_md, hints: packet ? row.hints_md : null, solution: row.solution_md,
    },
  });
});

function reportPayload(instance: LoadedInstance, fields: Field[]) {
  const isInterviewer = instance.kind === 'interviewer_report';
  return {
    id: instance.id,
    kind: instance.kind,
    round: instance.week_idx,
    role: isInterviewer ? 'interviewer' : 'interviewee',
    assigneeName: instance.assignee_name,
    partnerName: isInterviewer ? instance.interviewee_name : instance.interviewer_name,
    scheduledAt: instance.scheduled_at,
    deadlineAt: instance.deadline_at,
    submittedAt: instance.submitted_at,
    overdue: !instance.submitted_at && new Date() > new Date(instance.deadline_at),
    fields,
    values: instance.payload ? JSON.parse(instance.payload) : {},
  };
}
