import { Hono } from 'hono';
import type { Env } from '../env';
import { BLURB_MIN_WORDS, EXPERIENCE, OPPORTUNITIES, PROGRAMS, TOPICS, YEARS } from '../intake';
import { signToken } from '../forms/token';
import { updateParticipantSettings, type ParticipantSettingsInput } from '../services/participant-settings';
import { sessionFrom } from './web';
import { activeCohort, cohortWeeks } from '../engine/weeks';
import { currentProgramPhase } from '../program-calendar';

export const api = new Hono<{ Bindings: Env }>();

api.get('/api/practice', async (c) => {
  const session = await sessionFrom(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  const cohort = await activeCohort(c.env);
  const weeks = cohort ? await cohortWeeks(c.env, cohort.id) : [];
  const now = Date.now();
  const current = weeks.find((week) =>
    now >= new Date(week.match_at).getTime()
    && now <= new Date(week.grace_until ?? week.reports_due_at).getTime())
    ?? null;
  if (session.organizer) {
    const { results } = await c.env.DB.prepare(
      `SELECT week_idx AS round, number, title, url, difficulty FROM practice_problems
       WHERE active = 1 ORDER BY week_idx, id`,
    ).all<any>();
    const upcoming = current ?? weeks.find((week) => now < new Date(week.match_at).getTime()) ?? weeks.at(-1);
    return c.json({ organizer: true, cohort: cohort ? { name: cohort.name } : null, round: upcoming?.idx ?? null, problems: results });
  }
  if (!cohort || !current) {
    return c.json({ organizer: false, cohort: cohort ? { name: cohort.name } : null, round: null, problems: [] });
  }
  const { results } = await c.env.DB.prepare(
    `SELECT week_idx AS round, number, title, url, difficulty FROM practice_problems
     WHERE week_idx = ?1 AND active = 1 ORDER BY id`,
  ).bind(current.idx).all<any>();
  return c.json({ organizer: false, cohort: { name: cohort.name }, round: current.idx, problems: results });
});

api.get('/api/dashboard', async (c) => {
  const session = await sessionFrom(c);
  if (!session) return c.json({ error: 'unauthorized' }, 401);
  const secret = c.env.FORM_SIGNING_SECRET;
  if (!secret) return c.json({ error: 'not_configured' }, 503);

  const participantPromise = c.env.DB.prepare(
    `SELECT p.*,
            (SELECT count(*) FROM sessions s WHERE s.interviewer_id = p.id AND s.interviewer_credited = 1) AS interviewer_credits,
            (SELECT count(*) FROM sessions s WHERE s.interviewee_id = p.id AND s.interviewee_credited = 1) AS interviewee_credits,
            (SELECT count(*) FROM incidents i WHERE i.accused_id = p.id AND i.state = 'confirmed' AND i.kind IN ('ghost', 'unresponsive')) AS strikes
     FROM participants p WHERE p.id = ?1`,
  )
    .bind(session.participantId)
    .first<any>();
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
  const cohortPromise = activeCohort(c.env);

  const [participant, sessionsResult, owedResult, cohort] = await Promise.all([
    participantPromise,
    sessionsPromise,
    owedPromise,
    cohortPromise,
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
    programWeek: cohort ? currentProgramPhase(cohort) : null,
    participant: {
      id: participant.id,
      discordId: participant.discord_id,
      discordUsername: participant.discord_username ?? '',
      discordNickname: participant.discord_nickname ?? '',
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
    progress: {
      interviewer: Number(participant.interviewer_credits ?? 0),
      interviewee: Number(participant.interviewee_credits ?? 0),
      strikes: Number(participant.strikes ?? 0),
    },
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
    minimumBlurbWords: BLURB_MIN_WORDS,
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
