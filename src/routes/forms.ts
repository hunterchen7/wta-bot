import { Hono } from 'hono';
import type { Env } from '../env';
import { onReportSubmitted } from '../engine/reports';
import { esc, page, renderField } from '../forms/render';
// (verifyToken imported lazily in /p to keep the hot form path lean)
import { fieldsFor, validate } from '../forms/schema';
import { verifyFormToken } from '../forms/token';
import { formatToronto } from '../time';

// External form rail (DESIGN §5, §10): server-rendered from this same Worker.
// Token authenticates the bearer to one form instance; the row is truth.

export const forms = new Hono<{ Bindings: Env }>();

type LoadedInstance = {
  id: number;
  kind: string;
  session_id: number;
  assignee_id: number;
  deadline_at: string;
  submitted_at: string | null;
  payload: string | null;
  week_idx: number;
  scheduled_at: string | null;
  interviewer_name: string | null;
  interviewee_name: string | null;
  interviewer_id: number;
  interviewee_id: number;
  assignee_name: string | null;
};

async function loadInstance(env: Env, token: string): Promise<LoadedInstance | null> {
  const secret = env.FORM_SIGNING_SECRET;
  if (!secret) return null;
  const verified = await verifyFormToken(secret, token);
  if (!verified) return null;
  return env.DB.prepare(
    `SELECT f.id, f.kind, f.session_id, f.assignee_id, f.deadline_at, f.submitted_at, f.payload,
            w.idx AS week_idx, s.scheduled_at, s.interviewer_id, s.interviewee_id,
            pi.name AS interviewer_name, pe.name AS interviewee_name, pa.name AS assignee_name
     FROM form_instances f
     JOIN sessions s ON s.id = f.session_id
     JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     JOIN participants pa ON pa.id = f.assignee_id
     WHERE f.id = ?1`,
  )
    .bind(verified.instanceId)
    .first<LoadedInstance>();
}

function contextHeader(inst: LoadedInstance): string {
  const isInterviewer = inst.kind === 'interviewer_report';
  const partner = isInterviewer ? inst.interviewee_name : inst.interviewer_name;
  const role = isInterviewer ? `you interviewed **${partner}**` : `**${partner}** interviewed you`;
  return `
    <h1>Week ${inst.week_idx} — ${isInterviewer ? 'interviewer' : 'interviewee'} report</h1>
    <p class="sub">Hi ${esc(inst.assignee_name ?? 'there')} — ${role
      .replaceAll('**', '')
      .trim()}${inst.scheduled_at ? `, ${esc(formatToronto(inst.scheduled_at))} (Toronto)` : ''}.
      Due <b>${esc(formatToronto(inst.deadline_at))}</b>. You can re-submit until then — last submission wins.</p>`;
}

forms.get('/f/:token', async (c) => {
  if (!c.env.FORM_SIGNING_SECRET) return c.html(page('Not configured', '<h1>Form rail not configured</h1>'), 503);
  const inst = await loadInstance(c.env, c.req.param('token'));
  if (!inst) {
    return c.html(
      page('Link invalid or expired', '<h1>Link invalid or expired</h1><p class="sub">Grab a fresh link from <code>/status</code> in Discord.</p>'),
      404,
    );
  }
  const fields = fieldsFor(inst.kind);
  if (!fields) return c.html(page('Unknown form', '<h1>Unknown form type</h1>'), 400);
  const existing = inst.payload ? (JSON.parse(inst.payload) as Record<string, string>) : {};
  const late = new Date() > new Date(inst.deadline_at);
  const body = `
    ${contextHeader(inst)}
    ${inst.submitted_at ? `<div class="ok">Submitted ${esc(formatToronto(inst.submitted_at))} — you can revise below.</div>` : ''}
    ${late && !inst.submitted_at ? `<div class="err">This report is <b>overdue</b> — submit ASAP; your session credit is on hold.</div>` : ''}
    <form method="POST">
      ${fields.map((f) => renderField(f, existing[f.id])).join('\n')}
      <p style="margin-top:1.4rem"><button type="submit">Submit report</button></p>
    </form>`;
  return c.html(page(`Week ${inst.week_idx} report`, body));
});

forms.post('/f/:token', async (c) => {
  if (!c.env.FORM_SIGNING_SECRET) return c.text('not configured', 503);
  const inst = await loadInstance(c.env, c.req.param('token'));
  if (!inst) return c.html(page('Link invalid or expired', '<h1>Link invalid or expired</h1>'), 404);
  const fields = fieldsFor(inst.kind);
  if (!fields) return c.html(page('Unknown form', '<h1>Unknown form type</h1>'), 400);

  const body = await c.req.parseBody();
  const { ok, errors, payload } = validate(fields, body as Record<string, unknown>);
  if (!ok) {
    const form = `
      ${contextHeader(inst)}
      <div class="err"><b>Fix these and resubmit:</b><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>
      <form method="POST">
        ${fields.map((f) => renderField(f, String((body as any)[f.id] ?? ''))).join('\n')}
        <p style="margin-top:1.4rem"><button type="submit">Submit report</button></p>
      </form>`;
    return c.html(page('Fix and resubmit', form), 400);
  }

  if (new Date() > new Date(inst.deadline_at)) payload._late = 'true';
  const firstSubmission = inst.submitted_at === null;
  await c.env.DB.prepare(
    `UPDATE form_instances SET payload = ?2, submitted_at = ?3 WHERE id = ?1`,
  )
    .bind(inst.id, JSON.stringify(payload), new Date().toISOString())
    .run();

  if (firstSubmission) {
    await onReportSubmitted(c.env, inst as any, payload, new URL(c.req.url).origin);
  }

  return c.html(
    page(
      'Report submitted',
      `<div class="ok"><b>Report submitted — thank you!</b></div>
       <p class="sub">Your session credit is in. ${payload.partner_feedback || payload.strengths ? 'Shared feedback is relayed once both reports are in.' : ''}
       You can reopen this link to revise until the deadline.</p>
       <p><a class="btn ghost" href="">Review / edit submission</a></p>`,
    ),
  );
});

// Interviewer packet (subject p:<sessionId>) and interviewee solution release
// (subject sol:<sessionId>) share one renderer with different depth.
forms.get('/p/:token', async (c) => {
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.html(page('Not configured', '<h1>Not configured</h1>'), 503);
  const { verifyToken } = await import('../forms/token');
  const verified = await verifyToken(secret, c.req.param('token'));
  const match = verified && /^(p|sol):(\d+)$/.exec(verified.subject);
  if (!match) {
    return c.html(page('Link invalid or expired', '<h1>Link invalid or expired</h1>'), 404);
  }
  const isPacket = match[1] === 'p';
  const row = await c.env.DB.prepare(
    `SELECT s.id, s.scheduled_at, w.idx AS week_idx, p.number, p.title, p.url,
            p.difficulty, p.statement_md, p.solution_md, p.hints_md,
            pe.name AS interviewee_name
     FROM sessions s
     JOIN weeks w ON w.id = s.week_id
     JOIN problems p ON p.id = s.problem_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.id = ?1`,
  )
    .bind(Number(match[2]))
    .first<any>();
  if (!row) return c.html(page('Not found', '<h1>No problem assigned (yet)</h1>'), 404);

  const md = (s: string | null) => (s ? `<div class="card" style="white-space:pre-wrap">${esc(s)}</div>` : '');
  const body = `
    <h1>${isPacket ? '🎯 Interviewer packet' : '📖 Solution notes'} — Week ${row.week_idx}</h1>
    <p class="sub">${esc(row.title)}${row.number ? ` (#${row.number})` : ''} · ${esc(row.difficulty)}${
      isPacket ? ` · interviewing ${esc(row.interviewee_name ?? '')}` : ''
    }${row.url ? ` · <a href="${esc(row.url)}" rel="noreferrer">problem link ↗</a>` : ''}</p>
    ${isPacket ? '<div class="err">🤫 For your eyes only — your interviewee must not see this before the session.</div>' : ''}
    ${row.statement_md ? `<h2>Statement</h2>${md(row.statement_md)}` : ''}
    ${isPacket && row.hints_md ? `<h2>Hint ladder</h2>${md(row.hints_md)}` : ''}
    ${row.solution_md ? `<h2>Solution</h2>${md(row.solution_md)}` : '<p class="sub">No solution notes uploaded — organizers can add them on the dashboard.</p>'}
  `;
  return c.html(page(isPacket ? 'Interviewer packet' : 'Solution', body));
});
