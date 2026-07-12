import { Hono } from 'hono';
import { creditsOf, strikesOf } from '../engine/progress';
import type { Env } from '../env';
import { EXPERIENCE, OPPORTUNITIES, PROGRAMS, TOPICS, YEARS } from '../intake';
import { signToken } from '../forms/token';
import { updateParticipantSettings, type ParticipantSettingsInput } from '../services/participant-settings';
import { sessionFrom } from './web';

export const api = new Hono<{ Bindings: Env }>();

api.get('/api/dashboard', async (c) => {
  const session = await sessionFrom(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.json({ error: 'not_configured' }, 503);

  const participantPromise = c.env.DB.prepare('SELECT * FROM participants WHERE id = ?1')
    .bind(session.participantId)
    .first<any>();
  const creditsPromise = creditsOf(c.env, session.participantId);
  const strikesPromise = strikesOf(c.env, session.participantId);
  const sessionsPromise = c.env.DB.prepare(
    `SELECT s.id, s.state, s.scheduled_at, s.interviewer_id, s.interviewee_id,
            w.idx, pi.name AS interviewer_name, pe.name AS interviewee_name
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     JOIN participants pi ON pi.id = s.interviewer_id
     JOIN participants pe ON pe.id = s.interviewee_id
     WHERE s.interviewer_id = ?1 OR s.interviewee_id = ?1
     ORDER BY w.idx, s.id`,
  )
    .bind(session.participantId)
    .all<any>();
  const owedPromise = c.env.DB.prepare(
    `SELECT id, kind, deadline_at FROM form_instances
     WHERE assignee_id = ?1 AND submitted_at IS NULL ORDER BY deadline_at`,
  )
    .bind(session.participantId)
    .all<any>();

  const [participant, credits, strikes, sessionsResult, owedResult] = await Promise.all([
    participantPromise,
    creditsPromise,
    strikesPromise,
    sessionsPromise,
    owedPromise,
  ]);
  if (!participant) return c.json({ error: 'not_found' }, 404);

  const owedReports = await Promise.all(
    owedResult.results.map(async (report) => ({
      id: report.id,
      kind: report.kind,
      deadlineAt: report.deadline_at,
      url: `/f/${await signToken(secret, `f:${report.id}`, new Date(new Date(report.deadline_at).getTime() + 7 * 86400_000))}`,
    })),
  );
  const jsonList = (value: string | null): string[] => {
    try {
      return value ? JSON.parse(value) : [];
    } catch {
      return [];
    }
  };

  return c.json({
    viewer: { participantId: session.participantId, organizer: session.organizer },
    participant: {
      id: participant.id,
      name: participant.name ?? '',
      preferredEmail: participant.preferred_email ?? '',
      westernEmail: participant.western_email ?? '',
      year: participant.year ?? '',
      program: participant.program ?? '',
      opportunities: jsonList(participant.opportunities),
      priorWta: participant.prior_wta === 1,
      experience: participant.experience_band ?? '',
      topics: jsonList(participant.topics),
      blurb: participant.blurb ?? '',
      interests: participant.interests ?? '',
      priorFeedback: participant.prior_feedback ?? '',
      emailOk: participant.email_ok === 1,
      status: participant.status,
    },
    progress: { ...credits, strikes },
    sessions: sessionsResult.results.map((row) => {
      const isInterviewer = row.interviewer_id === session.participantId;
      return {
        id: row.id,
        round: row.idx,
        role: isInterviewer ? 'interviewer' : 'interviewee',
        partnerName: isInterviewer ? row.interviewee_name : row.interviewer_name,
        scheduledAt: row.scheduled_at,
        state: row.state,
      };
    }),
    owedReports,
    options: {
      years: YEARS,
      programs: PROGRAMS,
      experience: EXPERIENCE,
      opportunities: OPPORTUNITIES,
      topics: TOPICS,
    },
  });
});

api.post('/api/settings', async (c) => {
  const session = await sessionFrom(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  let input: ParticipantSettingsInput;
  try {
    input = await c.req.json<ParticipantSettingsInput>();
  } catch {
    return c.json({ error: 'invalid_json', message: 'Invalid settings request.' }, 400);
  }
  const result = await updateParticipantSettings(c.env, session.participantId, input);
  if (!result.ok) return c.json({ error: result.code, message: result.message, fieldErrors: result.fieldErrors }, result.status);
  return c.json({ ok: true });
});
