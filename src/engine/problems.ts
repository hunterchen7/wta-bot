import type { Env } from '../env';
import { signToken } from '../forms/token';
import { discordTime } from '../time';
import { buttonRow } from '../discord/components';
import { enqueue } from './outbox';

// Problem bank (DESIGN §6). Each question explicitly declares the round
// numbers in which it is available; difficulty rank remains useful metadata.

export async function generateWeekSet(
  env: Env,
  weekId: number,
  weekIdx: number,
  size = 5,
): Promise<{ chosen: Array<{ id: number; title: string }>; poolSize: number }> {
  const { results: pool } = await env.DB.prepare(
    `SELECT p.id, p.title FROM problems p
     WHERE p.active = 1
       AND EXISTS (SELECT 1 FROM json_each(p.available_weeks) WHERE value = ?1)
       AND p.id NOT IN (
         SELECT wps.problem_id FROM week_problem_sets wps
         JOIN weeks w ON w.id = wps.week_id
         WHERE w.cohort_id = (SELECT cohort_id FROM weeks WHERE id = ?2)
       )
     ORDER BY RANDOM() LIMIT ?3`,
  )
    .bind(weekIdx, weekId, size)
    .all<{ id: number; title: string }>();

  await env.DB.prepare('DELETE FROM week_problem_sets WHERE week_id = ?1').bind(weekId).run();
  for (const p of pool) {
    await env.DB.prepare('INSERT INTO week_problem_sets (week_id, problem_id) VALUES (?1, ?2)')
      .bind(weekId, p.id)
      .run();
  }
  return { chosen: pool, poolSize: pool.length };
}

/** Pick a problem for a session only when neither participant has seen it.
 *  Assigned sessions count immediately, so a participant's interviewer packet
 *  can never become the problem they later receive as an interviewee (or vice versa). */
export async function pickProblem(
  env: Env,
  weekId: number,
  interviewerId: number,
  intervieweeId: number,
  excludeProblemId?: number,
): Promise<{ id: number; title: string } | null> {
  return env.DB.prepare(
    `
    SELECT p.id, p.title FROM week_problem_sets wps
    JOIN problems p ON p.id = wps.problem_id AND p.active = 1
    WHERE wps.week_id = ?1
      AND NOT EXISTS (
        SELECT 1 FROM exposures e
        WHERE e.problem_id = p.id AND e.participant_id IN (?2, ?3)
      )
      AND NOT EXISTS (
        SELECT 1 FROM sessions seen
        WHERE seen.problem_id = p.id
          AND (seen.interviewer_id IN (?2, ?3) OR seen.interviewee_id IN (?2, ?3))
      )
      AND (?4 IS NULL OR p.id != ?4)
    ORDER BY RANDOM() LIMIT 1`,
  )
    .bind(weekId, intervieweeId, interviewerId, excludeProblemId ?? null)
    .first<{ id: number; title: string }>();
}

/** Reserve a problem without revealing it. Matching and repair flows use this
 *  immediately so both of a participant's role assignments remain distinct. */
export async function reserveProblem(
  env: Env,
  sessionId: number,
  problemId: number,
  replace = false,
): Promise<boolean> {
  const result = await env.DB.prepare(
    replace
      ? 'UPDATE sessions SET problem_id = ?1, packet_sent_at = NULL WHERE id = ?2'
      : 'UPDATE sessions SET problem_id = ?1 WHERE id = ?2 AND problem_id IS NULL',
  ).bind(problemId, sessionId).run();
  return Number(result.meta.changes ?? 0) > 0;
}

/** Backstop sweep for scheduled sessions whose packet was not delivered by the
 *  scheduling interaction. Legacy unassigned sessions are reserved here too. */
export async function packetScan(env: Env, origin: string, now = new Date()): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.week_id, s.interviewer_id, s.interviewee_id, s.scheduled_at,
            s.problem_id, p.title AS problem_title, w.idx
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     LEFT JOIN problems p ON p.id = s.problem_id
     WHERE s.state = 'scheduled' AND s.packet_sent_at IS NULL AND s.scheduled_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM week_problem_sets wps WHERE wps.week_id = s.week_id)`,
  )
    .all<any>();

  let delivered = 0;
  for (const s of results) {
    const problem = s.problem_id
      ? { id: Number(s.problem_id), title: String(s.problem_title) }
      : await pickProblem(env, s.week_id, s.interviewer_id, s.interviewee_id);
    if (!problem) continue; // set exhausted — organizers see it in the digest
    if (!s.problem_id && !(await reserveProblem(env, s.id, problem.id))) continue;
    await deliverProblemPacket(env, s, problem, origin, false);
    delivered++;
  }
  return delivered;
}

/** Reveal one session's reserved packet as soon as its time is confirmed. */
export async function deliverSessionProblem(env: Env, sessionId: number, origin: string): Promise<boolean> {
  const session = await env.DB.prepare(
    `SELECT s.id, s.week_id, s.interviewer_id, s.interviewee_id, s.scheduled_at,
            s.problem_id, s.packet_sent_at, p.title AS problem_title
     FROM sessions s LEFT JOIN problems p ON p.id = s.problem_id
     WHERE s.id = ?1 AND s.state = 'scheduled'`,
  ).bind(sessionId).first<any>();
  if (!session || session.packet_sent_at) return false;
  const problem = session.problem_id
    ? { id: Number(session.problem_id), title: String(session.problem_title) }
    : await pickProblem(env, session.week_id, session.interviewer_id, session.interviewee_id);
  if (!problem) return false;
  if (!session.problem_id && !(await reserveProblem(env, session.id, problem.id))) return false;
  await deliverProblemPacket(env, session, problem, origin, false);
  return true;
}

export async function assignProblem(
  env: Env,
  session: { id: number; week_id: number; interviewer_id: number; interviewee_id: number; scheduled_at?: string | null },
  problem: { id: number; title: string },
  origin: string,
  isSwap: boolean,
): Promise<string> {
  await reserveProblem(env, session.id, problem.id, true);
  return deliverProblemPacket(env, session, problem, origin, isSwap);
}

async function deliverProblemPacket(
  env: Env,
  session: { id: number; interviewer_id: number; scheduled_at?: string | null },
  problem: { id: number; title: string },
  origin: string,
  isSwap: boolean,
): Promise<string> {
  await env.DB.prepare(
    `INSERT INTO exposures (participant_id, problem_id, role, session_id)
     SELECT ?1, ?2, 'interviewer', ?3
     WHERE NOT EXISTS (
       SELECT 1 FROM exposures
       WHERE participant_id = ?1 AND problem_id = ?2 AND role = 'interviewer' AND session_id = ?3
     )`,
  )
    .bind(session.interviewer_id, problem.id, session.id)
    .run();

  const secret = env.FORM_SIGNING_SECRET;
  const interviewer = await env.DB.prepare('SELECT discord_id FROM participants WHERE id = ?1')
    .bind(session.interviewer_id)
    .first<{ discord_id: string }>();
  if (!secret || !interviewer) return '';

  const token = await signToken(secret, `p:${session.id}`, new Date(Date.now() + 14 * 86400_000));
  const url = `${origin}/p/${token}`;
  await enqueue(env, 'dm', {
    userId: interviewer.discord_id,
    fallbackKind: 'packet',
    message: {
      content:
        `🎯 ${isSwap ? 'New problem after your swap' : 'Your interviewer packet is ready'}: **${problem.title}**\n` +
        `${url}\n` +
        `Problem, solution, and hint ladder inside — read it before the session${session.scheduled_at ? ` (${discordTime(session.scheduled_at)})` : ''}. ` +
        `Your interviewee sees nothing until it's live. 🤫`,
      components: [buttonRow([{ id: `swap:${session.id}`, label: 'Swap problem', style: 2 }])],
    },
  });
  await env.DB.prepare('UPDATE sessions SET packet_sent_at = ?2 WHERE id = ?1')
    .bind(session.id, new Date().toISOString()).run();
  return url;
}

/** Interviewer-requested swap: re-pick excluding the current problem. */
export async function swapProblem(env: Env, sessionId: number, requesterDiscordId: string, origin: string): Promise<string> {
  const s = await env.DB.prepare(
    `SELECT s.id, s.week_id, s.interviewer_id, s.interviewee_id, s.problem_id, s.scheduled_at, p.discord_id AS interviewer_discord
     FROM sessions s JOIN participants p ON p.id = s.interviewer_id WHERE s.id = ?1`,
  )
    .bind(sessionId)
    .first<any>();
  if (!s) return 'Session not found.';
  if (s.interviewer_discord !== requesterDiscordId) return 'Only the interviewer can swap the problem.';
  if (s.scheduled_at && new Date(s.scheduled_at) < new Date()) return 'The session already started — no swaps now.';
  const next = await pickProblem(env, s.week_id, s.interviewer_id, s.interviewee_id, s.problem_id);
  if (!next) return 'No other eligible problem left in this week\'s set — ping an organizer.';
  await assignProblem(env, s, next, origin, true);
  return `Swapped ✅ — new packet DM incoming: **${next.title}**.`;
}

/** After the interviewee files their report: exposure + solution link.
 *  Idempotent — the interviewee exposure row marks it done. */
export async function releaseSolution(env: Env, sessionId: number, origin: string): Promise<void> {
  const s = await env.DB.prepare(
    `SELECT s.problem_id, s.interviewee_id, p.discord_id FROM sessions s
     JOIN participants p ON p.id = s.interviewee_id WHERE s.id = ?1`,
  )
    .bind(sessionId)
    .first<{ problem_id: number | null; interviewee_id: number; discord_id: string }>();
  if (!s?.problem_id) return;
  const already = await env.DB.prepare(
    `SELECT 1 AS x FROM exposures WHERE session_id = ?1 AND role = 'interviewee' LIMIT 1`,
  )
    .bind(sessionId)
    .first();
  if (already) return;
  await env.DB.prepare(
    `INSERT INTO exposures (participant_id, problem_id, role, session_id) VALUES (?1, ?2, 'interviewee', ?3)`,
  )
    .bind(s.interviewee_id, s.problem_id, sessionId)
    .run();
  const secret = env.FORM_SIGNING_SECRET;
  if (!secret) return;
  const token = await signToken(secret, `sol:${sessionId}`, new Date(Date.now() + 30 * 86400_000));
  await enqueue(env, 'dm', {
    userId: s.discord_id,
    fallbackKind: 'solution',
    message: {
      content: `📖 Report received — here's the **solution + notes** for the problem you just did: ${origin}/p/${token}\nClose the loop while it's fresh!`,
    },
  });
}
