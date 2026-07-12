import type { Env } from '../env';
import { signToken } from '../forms/token';
import { discordTime } from '../time';
import { buttonRow } from '../discord/components';
import { enqueue } from './outbox';

// Problem bank (DESIGN §6). Difficulty progression via effective rank:
// easy=1, medium=2, hard=3 unless a finer difficulty_rank is set.
// W1 [1,1.9] · W2 [2,2.4] · W3 [2.5,3.1] — the W3 band is deliberately tight
// (last year's variance problem).

export const WEEK_BANDS: Record<number, [number, number]> = {
  1: [1.0, 1.9],
  2: [2.0, 2.4],
  3: [2.5, 3.1],
};

const EFFECTIVE_RANK = `COALESCE(p.difficulty_rank, CASE p.difficulty WHEN 'easy' THEN 1.0 WHEN 'medium' THEN 2.0 ELSE 3.0 END)`;

export async function generateWeekSet(
  env: Env,
  weekId: number,
  weekIdx: number,
  size = 5,
): Promise<{ chosen: Array<{ id: number; title: string }>; poolSize: number }> {
  const [lo, hi] = WEEK_BANDS[Math.min(weekIdx, 3)] ?? WEEK_BANDS[3]!;
  const { results: pool } = await env.DB.prepare(
    `SELECT p.id, p.title FROM problems p
     WHERE p.active = 1 AND ${EFFECTIVE_RANK} BETWEEN ?1 AND ?2
       AND p.id NOT IN (
         SELECT wps.problem_id FROM week_problem_sets wps
         JOIN weeks w ON w.id = wps.week_id
         WHERE w.cohort_id = (SELECT cohort_id FROM weeks WHERE id = ?3)
       )
     ORDER BY RANDOM() LIMIT ?4`,
  )
    .bind(lo, hi, weekId, size)
    .all<{ id: number; title: string }>();

  await env.DB.prepare('DELETE FROM week_problem_sets WHERE week_id = ?1').bind(weekId).run();
  for (const p of pool) {
    await env.DB.prepare('INSERT INTO week_problem_sets (week_id, problem_id) VALUES (?1, ?2)')
      .bind(weekId, p.id)
      .run();
  }
  return { chosen: pool, poolSize: pool.length };
}

/** Pick a problem for a session: from the week set, unseen by the interviewee
 *  (any role), preferring unseen by the interviewer too. */
export async function pickProblem(
  env: Env,
  weekId: number,
  interviewerId: number,
  intervieweeId: number,
  excludeProblemId?: number,
): Promise<{ id: number; title: string } | null> {
  const base = `
    SELECT p.id, p.title FROM week_problem_sets wps
    JOIN problems p ON p.id = wps.problem_id AND p.active = 1
    WHERE wps.week_id = ?1
      AND p.id NOT IN (SELECT problem_id FROM exposures WHERE participant_id = ?2)
      AND (?4 IS NULL OR p.id != ?4)`;
  // Preferred: also unseen by the interviewer
  const preferred = await env.DB.prepare(
    `${base} AND p.id NOT IN (SELECT problem_id FROM exposures WHERE participant_id = ?3)
     ORDER BY RANDOM() LIMIT 1`,
  )
    .bind(weekId, intervieweeId, interviewerId, excludeProblemId ?? null)
    .first<{ id: number; title: string }>();
  if (preferred) return preferred;
  return env.DB.prepare(`${base} ORDER BY RANDOM() LIMIT 1`)
    .bind(weekId, intervieweeId, interviewerId, excludeProblemId ?? null)
    .first<{ id: number; title: string }>();
}

/** T-24h packet sweep: assign problems + DM the interviewer their packet. */
export async function packetScan(env: Env, origin: string, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() + 24 * 3600_000).toISOString();
  const { results } = await env.DB.prepare(
    `SELECT s.id, s.week_id, s.interviewer_id, s.interviewee_id, s.scheduled_at, w.idx
     FROM sessions s JOIN weeks w ON w.id = s.week_id
     WHERE s.state = 'scheduled' AND s.problem_id IS NULL AND s.scheduled_at <= ?1
       AND EXISTS (SELECT 1 FROM week_problem_sets wps WHERE wps.week_id = s.week_id)`,
  )
    .bind(cutoff)
    .all<any>();

  let assigned = 0;
  for (const s of results) {
    const problem = await pickProblem(env, s.week_id, s.interviewer_id, s.interviewee_id);
    if (!problem) continue; // set exhausted — organizers see it in the digest
    await assignProblem(env, s, problem, origin, false);
    assigned++;
  }
  return assigned;
}

export async function assignProblem(
  env: Env,
  session: { id: number; week_id: number; interviewer_id: number; interviewee_id: number; scheduled_at?: string | null },
  problem: { id: number; title: string },
  origin: string,
  isSwap: boolean,
): Promise<string> {
  await env.DB.prepare('UPDATE sessions SET problem_id = ?1 WHERE id = ?2')
    .bind(problem.id, session.id)
    .run();
  await env.DB.prepare(
    `INSERT INTO exposures (participant_id, problem_id, role, session_id) VALUES (?1, ?2, 'interviewer', ?3)`,
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

/** After the interviewee files their report: exposure + solution link. */
export async function releaseSolution(env: Env, sessionId: number, origin: string): Promise<void> {
  const s = await env.DB.prepare(
    `SELECT s.problem_id, s.interviewee_id, p.discord_id FROM sessions s
     JOIN participants p ON p.id = s.interviewee_id WHERE s.id = ?1`,
  )
    .bind(sessionId)
    .first<{ problem_id: number | null; interviewee_id: number; discord_id: string }>();
  if (!s?.problem_id) return;
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
