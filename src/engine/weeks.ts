import type { Env } from '../env';
import { iso, torontoToUtc } from '../time';

// Cohort calendar (DESIGN.md §2). All anchors are Toronto wall time,
// stored UTC. Week i runs Monday..Sunday; opt-in opens the Friday before.

export type Week = {
  id: number;
  cohort_id: number;
  idx: number;
  optin_opens_at: string;
  optin_closes_at: string;
  match_at: string;
  reports_due_at: string;
  grace_until: string | null;
};

export type Cohort = { id: number; name: string; start_date: string; weeks_count: number; status: string };

/** Day-arithmetic on wall dates (DST-safe: works on the date triple). */
function addDays(y: number, m: number, d: number, days: number): [number, number, number] {
  const t = new Date(Date.UTC(y, m - 1, d, 12)); // noon avoids boundary issues
  t.setUTCDate(t.getUTCDate() + days);
  return [t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()];
}

// A "round" is a 14-day window (2026 schedule: R1 Jul 26–Aug 8, R2 Aug 9–22,
// R3 Aug 23–Sep 5 — starting on Sundays). Rows in the `weeks` table are
// rounds; `idx` = round number. Anchors are relative to the round's start day,
// so any start weekday works.
export const ROUND_DAYS = 14;

export function weekAnchors(roundOneStart: [number, number, number], idx: number) {
  const start = addDays(...roundOneStart, (idx - 1) * ROUND_DAYS);
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const [y, m, d] = addDays(...start, dayOffset);
    return torontoToUtc(y, m, d, hour, minute);
  };
  return {
    optin_opens_at: at(-3, 16), // 3 days before the round, 16:00
    optin_remind_at: at(-2, 18), // non-responder reminder
    optin_closes_at: at(-1, 18), // eve of the round, 18:00
    match_at: at(-1, 18, 15), // pairings drop 15 min later
    nudge_at: at(3, 18), // mid-week-1 unscheduled nudge
    nudge2_at: at(10, 18), // mid-week-2 unscheduled nudge
    reports_due_at: at(ROUND_DAYS - 1, 23, 59), // final day of the round
    digest_at: at(ROUND_DAYS, 9), // morning after the round
    grace_until: at(ROUND_DAYS + 4, 23, 59), // final round only
  };
}

export function cohortStartTuple(cohort: Cohort): [number, number, number] {
  const [y, m, d] = cohort.start_date.split('-').map(Number);
  return [y!, m!, d!];
}

export async function createCohort(
  env: Env,
  name: string,
  roundOneStart: [number, number, number],
  weeksCount = 3,
): Promise<{ cohortId: number; weeks: Week[] }> {
  await env.DB.prepare("UPDATE cohorts SET status = 'done' WHERE status = 'active'").run();
  const [y, m, d] = roundOneStart;
  const res = await env.DB.prepare(
    "INSERT INTO cohorts (name, start_date, weeks_count, status) VALUES (?1, ?2, ?3, 'active')",
  )
    .bind(name, `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, weeksCount)
    .run();
  const cohortId = Number(res.meta.last_row_id);

  for (let idx = 1; idx <= weeksCount; idx++) {
    const a = weekAnchors(roundOneStart, idx);
    await env.DB.prepare(
      `INSERT INTO weeks (cohort_id, idx, optin_opens_at, optin_closes_at, match_at, reports_due_at, grace_until)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    )
      .bind(
        cohortId,
        idx,
        iso(a.optin_opens_at),
        iso(a.optin_closes_at),
        iso(a.match_at),
        iso(a.reports_due_at),
        idx === weeksCount ? iso(a.grace_until) : null,
      )
      .run();
  }
  const weeks = await cohortWeeks(env, cohortId);
  return { cohortId, weeks };
}

export async function activeCohort(env: Env): Promise<Cohort | null> {
  return env.DB.prepare("SELECT * FROM cohorts WHERE status = 'active' LIMIT 1").first<Cohort>();
}

export async function cohortWeeks(env: Env, cohortId: number): Promise<Week[]> {
  const { results } = await env.DB.prepare(
    'SELECT * FROM weeks WHERE cohort_id = ?1 ORDER BY idx',
  )
    .bind(cohortId)
    .all<Week>();
  return results;
}

export async function getWeek(env: Env, weekId: number): Promise<Week | null> {
  return env.DB.prepare('SELECT * FROM weeks WHERE id = ?1').bind(weekId).first<Week>();
}
