import type { Env } from '../env';
import { enqueue } from '../engine/outbox';
import { enqueueRepair } from '../engine/repair';
import { activeCohort, cohortWeeks } from '../engine/weeks';
import { composeQuestionMarkdown, normalizeAvailableWeeks, parseQuestionMarkdown } from '../question-markdown';
import { problemBankWorkspace } from './problem-sets';
import { writeAdminAudit } from './admin-audit';
import { enrollmentFunnel } from './enrollment-events';

export async function automationOverview(env: Env) {
  const [participants, sessions, forms, failedOutbox, lastTick, enrollment] = await Promise.all([
    env.DB.prepare(
      `SELECT CASE WHEN pairing_excluded = 1 THEN 'organizer' ELSE status END AS status, count(*) AS count
       FROM participants GROUP BY CASE WHEN pairing_excluded = 1 THEN 'organizer' ELSE status END`,
    ).all<any>(),
    env.DB.prepare('SELECT state, count(*) AS count FROM sessions GROUP BY state').all<any>(),
    env.DB.prepare(
      `SELECT kind, count(*) AS total,
              sum(CASE WHEN submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted
       FROM form_instances GROUP BY kind`,
    ).all<any>(),
    env.DB.prepare(
      `SELECT count(*) AS count FROM outbox
       WHERE done_at IS NULL AND dismissed_at IS NULL AND attempts >= 5`,
    ).first<{ count: number }>(),
    env.DB.prepare("SELECT job_key, ran_at FROM job_runs WHERE job_key LIKE 'tick:%' ORDER BY ran_at DESC LIMIT 1").first<any>(),
    enrollmentFunnel(env),
  ]);
  return {
    participants: participants.results,
    sessions: sessions.results,
    forms: forms.results,
    failedOutbox: Number(failedOutbox?.count ?? 0),
    cron: lastTick ? { lastTickAt: lastTick.ran_at, jobKey: lastTick.job_key } : null,
    enrollmentFunnel: enrollment,
  };
}

export async function automationParticipants(
  env: Env,
  options: { search?: string; status?: string; limit?: number } = {},
) {
  const search = options.search?.trim().toLowerCase() ?? '';
  const status = options.status?.trim() ?? '';
  const limit = Math.max(1, Math.min(200, Math.trunc(options.limit ?? 100)));
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.discord_id, p.discord_username, p.discord_nickname, p.name,
            p.preferred_email, p.western_email, p.year, p.program, p.status,
            p.email_ok, p.pairing_excluded, p.created_at, p.updated_at,
            (SELECT count(*) FROM sessions s WHERE s.interviewer_id = p.id AND s.interviewer_credited = 1) AS interviewer_credits,
            (SELECT count(*) FROM sessions s WHERE s.interviewee_id = p.id AND s.interviewee_credited = 1) AS interviewee_credits,
            (SELECT count(*) FROM form_instances f WHERE f.assignee_id = p.id AND f.submitted_at IS NULL) AS reports_owed
     FROM participants p
     WHERE (?1 = '' OR lower(coalesce(p.name, '') || ' ' || coalesce(p.preferred_email, '') || ' ' || coalesce(p.discord_username, '')) LIKE '%' || ?1 || '%')
       AND (?2 = '' OR p.status = ?2)
     ORDER BY lower(coalesce(p.name, '')), p.id LIMIT ?3`,
  ).bind(search, status, limit).all<any>();
  return results;
}

export async function automationParticipant(env: Env, id: number) {
  const participant = await env.DB.prepare('SELECT * FROM participants WHERE id = ?1').bind(id).first<any>();
  if (!participant) return null;
  const [sessions, forms, incidents] = await Promise.all([
    env.DB.prepare(
      `SELECT s.*, w.idx AS round, pi.name AS interviewer_name, pe.name AS interviewee_name,
              p.number AS problem_number, p.title AS problem_title
       FROM sessions s JOIN weeks w ON w.id = s.week_id
       JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
       LEFT JOIN problems p ON p.id = s.problem_id
       WHERE s.interviewer_id = ?1 OR s.interviewee_id = ?1 ORDER BY s.id DESC`,
    ).bind(id).all<any>(),
    env.DB.prepare(
      `SELECT id, kind, session_id, deadline_at, submitted_at, reminder_state
       FROM form_instances WHERE assignee_id = ?1 ORDER BY id DESC`,
    ).bind(id).all<any>(),
    env.DB.prepare(
      `SELECT id, session_id, kind, state, notes, created_at
       FROM incidents WHERE accused_id = ?1 OR reporter_id = ?1 ORDER BY id DESC`,
    ).bind(id).all<any>(),
  ]);
  return { participant, sessions: sessions.results, forms: forms.results, incidents: incidents.results };
}

export async function setAutomationParticipantStatus(
  env: Env,
  actorId: number,
  participantId: number,
  status: string,
  note?: string,
) {
  if (!['active', 'paused', 'held', 'removed', 'completed'].includes(status)) return null;
  const result = await env.DB.prepare(
    `UPDATE participants SET status = ?2, removed_reason = ?3, updated_at = datetime('now') WHERE id = ?1`,
  ).bind(participantId, status, status === 'removed' ? 'organizer' : null).run();
  if (!result.meta.changes) return null;
  await writeAdminAudit(env, actorId, 'automation.participant_status_changed', 'participant', participantId, {
    status,
    note: note?.slice(0, 500),
  });
  return { id: participantId, status };
}

type ReversibleParticipantStatus = 'paused' | 'held' | 'active';

export async function setReversibleAutomationParticipantStatus(
  env: Env,
  actorId: number,
  participantId: number,
  status: ReversibleParticipantStatus,
  note?: string,
) {
  const participant = await env.DB.prepare(
    'SELECT id, status FROM participants WHERE id = ?1',
  ).bind(participantId).first<{ id: number; status: string }>();
  if (!participant) return null;
  if (participant.status === 'removed' || participant.status === 'completed') return null;
  if (status === 'active' && !['active', 'paused', 'held'].includes(participant.status)) return null;
  if (participant.status !== status) {
    await env.DB.prepare(
      `UPDATE participants SET status = ?2, removed_reason = NULL, updated_at = datetime('now') WHERE id = ?1`,
    ).bind(participantId, status).run();
  }
  await writeAdminAudit(env, actorId, `automation.participant_${status}`, 'participant', participantId, {
    previousStatus: participant.status,
    note: note?.slice(0, 500),
  });
  return { id: participantId, previousStatus: participant.status, status };
}

export async function removeAutomationParticipant(
  env: Env,
  actorId: number,
  participantId: number,
  reason: string,
) {
  const participant = await env.DB.prepare(
    'SELECT id, discord_id, name, status FROM participants WHERE id = ?1',
  ).bind(participantId).first<{ id: number; discord_id: string; name: string | null; status: string }>();
  if (!participant) return null;
  if (participant.status === 'removed') {
    return { id: participantId, status: 'removed', alreadyRemoved: true, cancelledSessions: 0, partnersQueued: 0 };
  }

  const normalizedReason = reason.trim().slice(0, 500);
  if (!normalizedReason) return null;
  const now = new Date().toISOString();
  const { results: sessions } = await env.DB.prepare(
    `SELECT id, week_id, interviewer_id, interviewee_id, thread_id
     FROM sessions
     WHERE state IN ('pending_schedule', 'scheduled')
       AND (interviewer_id = ?1 OR interviewee_id = ?1)`,
  ).bind(participantId).all<{
    id: number; week_id: number; interviewer_id: number; interviewee_id: number; thread_id: string | null;
  }>();

  let partnersQueued = 0;
  for (const session of sessions) {
    await env.DB.prepare(
      "UPDATE sessions SET state = 'cancelled' WHERE id = ?1 AND state IN ('pending_schedule', 'scheduled')",
    ).bind(session.id).run();
    await env.DB.prepare(
      'DELETE FROM form_instances WHERE session_id = ?1 AND submitted_at IS NULL',
    ).bind(session.id).run();

    const wasInterviewer = session.interviewer_id === participantId;
    const partnerId = wasInterviewer ? session.interviewee_id : session.interviewer_id;
    const need = wasInterviewer ? 'interviewer' : 'interviewee';
    const existingRepair = await env.DB.prepare(
      `SELECT id FROM repair_queue
       WHERE week_id = ?1 AND participant_id = ?2 AND need = ?3 AND state = 'open' LIMIT 1`,
    ).bind(session.week_id, partnerId, need).first<{ id: number }>();
    if (!existingRepair) {
      await enqueueRepair(env, session.week_id, partnerId, need);
      partnersQueued++;
    }

    const partner = await env.DB.prepare(
      'SELECT discord_id FROM participants WHERE id = ?1',
    ).bind(partnerId).first<{ discord_id: string }>();
    const message = `Your WTA session with ${participant.name ?? 'your partner'} was cancelled by an organizer. You have been queued for re-pairing.`;
    if (session.thread_id) {
      await enqueue(env, 'channel_msg', { channelId: session.thread_id, message: { content: `📕 ${message}` } });
    }
    if (partner?.discord_id) {
      await enqueue(env, 'dm', { userId: partner.discord_id, fallbackKind: 'repair_pairing', message: { content: message } });
    }
  }

  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM optins WHERE participant_id = ?1
       AND week_id IN (SELECT id FROM weeks WHERE match_at > ?2)`,
    ).bind(participantId, now),
    env.DB.prepare(
      "UPDATE repair_queue SET state = 'expired' WHERE participant_id = ?1 AND state = 'open'",
    ).bind(participantId),
    env.DB.prepare(
      `UPDATE participants
       SET status = 'removed', removed_reason = ?2, updated_at = datetime('now')
       WHERE id = ?1`,
    ).bind(participantId, normalizedReason),
  ]);
  await enqueue(env, 'dm', {
    userId: participant.discord_id,
    message: { content: `An organizer removed you from the current WTA program. Reason: ${normalizedReason}\n\nContact an organizer if you think this is a mistake.` },
  });
  await writeAdminAudit(env, actorId, 'automation.participant_removed', 'participant', participantId, {
    reason: normalizedReason,
    cancelledSessions: sessions.length,
    partnersQueued,
  });
  return { id: participantId, status: 'removed', alreadyRemoved: false, cancelledSessions: sessions.length, partnersQueued };
}

export async function automationRounds(env: Env, requestedWeekId?: number, requestedRoundNumber?: number) {
  const cohort = await activeCohort(env);
  if (!cohort) return { cohort: null, weeks: [], selectedWeek: null, sessions: [], optins: [], repairs: [] };
  const weeks = await cohortWeeks(env, cohort.id);
  const now = Date.now();
  const currentWeek = weeks.find((week) => now <= new Date(week.grace_until ?? week.reports_due_at).getTime()) ?? weeks.at(-1)!;
  const selectedWeek = weeks.find((week) => week.id === requestedWeekId)
    ?? weeks.find((week) => week.idx === requestedRoundNumber)
    ?? currentWeek;
  const [sessions, optins, repairs] = await Promise.all([
    env.DB.prepare(
      `SELECT s.*, pi.name AS interviewer_name, pe.name AS interviewee_name,
              p.number AS problem_number, p.title AS problem_title,
              (SELECT count(*) FROM form_instances f WHERE f.session_id = s.id AND f.submitted_at IS NOT NULL) AS reports_in
       FROM sessions s JOIN participants pi ON pi.id = s.interviewer_id JOIN participants pe ON pe.id = s.interviewee_id
       LEFT JOIN problems p ON p.id = s.problem_id WHERE s.week_id = ?1 ORDER BY s.id`,
    ).bind(selectedWeek.id).all<any>(),
    env.DB.prepare(
      `SELECT o.*, p.name, p.discord_username, p.status FROM optins o
       JOIN participants p ON p.id = o.participant_id WHERE o.week_id = ?1 ORDER BY lower(p.name)`,
    ).bind(selectedWeek.id).all<any>(),
    env.DB.prepare(
      `SELECT r.*, p.name FROM repair_queue r JOIN participants p ON p.id = r.participant_id
       WHERE r.week_id = ?1 ORDER BY r.state, r.id`,
    ).bind(selectedWeek.id).all<any>(),
  ]);
  return { cohort, weeks, selectedWeek, sessions: sessions.results, optins: optins.results, repairs: repairs.results };
}

export async function automationProblems(env: Env) {
  return problemBankWorkspace(env);
}

export async function createAutomationProblem(env: Env, actorId: number, body: any) {
  const question = normalizeQuestionInput(body);
  if (!question) return null;
  const result = await env.DB.prepare(
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
  await writeAdminAudit(env, actorId, 'automation.problem_created', 'problem', id, {
    title: question.title,
    availableWeeks: question.availableWeeks,
  });
  return { id, ...question };
}

function normalizeQuestionInput(body: any) {
  if (!body?.title?.trim() || !['easy', 'medium', 'hard'].includes(body.difficulty)) return null;
  const availableWeeks = normalizeAvailableWeeks(body.availableWeeks);
  const content = String(body.content ?? composeQuestionMarkdown({
    statement: body.statement,
    hints: body.hints,
    solution: body.solution,
  })).trim().slice(0, 100_000);
  const sections = parseQuestionMarkdown(content);
  if (!availableWeeks.length || !sections.statement) return null;
  const rank = body.difficultyRank == null ? null : Number(body.difficultyRank);
  return {
    source: String(body.source ?? 'manual').trim().slice(0, 50) || 'manual',
    number: body.number == null ? null : Number(body.number),
    title: String(body.title).trim().slice(0, 200),
    url: String(body.url ?? '').trim().slice(0, 1000) || null,
    difficulty: body.difficulty as 'easy' | 'medium' | 'hard',
    difficultyRank: rank != null && Number.isFinite(rank) ? rank : null,
    content,
    availableWeeks,
    sections,
    active: body.active === false ? 0 : 1,
  };
}
