import type { Env } from '../env';

// Credit accounting (DESIGN §4/§5): your side of a session is credited when
// YOUR report is filed. Target = one credit per role per week elapsed.

export type Credits = { interviewer: number; interviewee: number };

export async function creditsOf(env: Env, participantId: number): Promise<Credits> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM sessions WHERE interviewer_id = ?1 AND interviewer_credited = 1) AS interviewer,
       (SELECT count(*) FROM sessions WHERE interviewee_id = ?1 AND interviewee_credited = 1) AS interviewee`,
  )
    .bind(participantId)
    .first<Credits>();
  return row ?? { interviewer: 0, interviewee: 0 };
}

/** Confirmed no-show strikes (ghost/unresponsive; late cancels are softer). */
export async function strikesOf(env: Env, participantId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT count(*) AS n FROM incidents
     WHERE accused_id = ?1 AND state = 'confirmed' AND kind IN ('ghost', 'unresponsive')`,
  )
    .bind(participantId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Per-role demand for a week: 1, or 2 when behind pace and asking to double —
 *  never more than what's still needed to reach the per-role target of 3. */
export function demandFor(
  weekIdx: number,
  credits: Credits,
  wantsDouble: boolean,
  target = 3,
): { interviewer: number; interviewee: number } {
  const per = (have: number) => {
    const remaining = Math.max(0, target - have);
    if (remaining === 0) return 0;
    const deficit = Math.max(0, weekIdx - 1 - have);
    const want = wantsDouble && deficit > 0 ? 2 : 1;
    return Math.min(want, remaining, 2);
  };
  return { interviewer: per(credits.interviewer), interviewee: per(credits.interviewee) };
}
