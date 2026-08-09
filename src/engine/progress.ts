import type { Env } from '../env';

// Credit accounting (DESIGN §4/§5): your side of a session is credited when
// YOUR report is filed. Target = one credit per role per week elapsed.
// All credits remain visible in progress and eligibility totals. Matching uses
// a narrower count that excludes sessions taken as a standby volunteer, so an
// extra never replaces the baseline interview offered in a later round.

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

/** Credits that can satisfy catch-up pace. A repair still counts for the
 * participant whose original session broke, while the counterpart recorded in
 * standby_assignments is treated as a bonus volunteer assignment. */
export async function matchingCreditsOf(env: Env, participantId: number): Promise<Credits> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT count(*) FROM sessions s
        WHERE s.interviewer_id = ?1 AND s.interviewer_credited = 1
          AND NOT EXISTS (
            SELECT 1 FROM standby_assignments sa
            WHERE sa.session_id = s.id AND sa.participant_id = ?1 AND sa.role = 'interviewer'
          )) AS interviewer,
       (SELECT count(*) FROM sessions s
        WHERE s.interviewee_id = ?1 AND s.interviewee_credited = 1
          AND NOT EXISTS (
            SELECT 1 FROM standby_assignments sa
            WHERE sa.session_id = s.id AND sa.participant_id = ?1 AND sa.role = 'interviewee'
          )) AS interviewee`,
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

/** Every opt-in requests one baseline session in each role for this round.
 * Catch-up adds one more only for roles missed before this round. Surplus
 * credits can never erase the current round's baseline. */
export function demandFor(
  weekIdx: number,
  credits: Credits,
  wantsDouble: boolean,
): { interviewer: number; interviewee: number } {
  const per = (have: number) => {
    const missedEarlierRounds = Math.max(0, weekIdx - 1 - have);
    return 1 + Number(wantsDouble && missedEarlierRounds > 0);
  };
  return { interviewer: per(credits.interviewer), interviewee: per(credits.interviewee) };
}
