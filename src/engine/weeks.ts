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

export function weekAnchors(week1Monday: [number, number, number], idx: number) {
  const monday = addDays(...week1Monday, (idx - 1) * 7);
  const at = (dayOffset: number, hour: number, minute = 0) => {
    const [y, m, d] = addDays(...monday, dayOffset);
    return torontoToUtc(y, m, d, hour, minute);
  };
  return {
    optin_opens_at: at(-3, 16), // Friday 16:00
    optin_remind_at: at(-2, 18), // Saturday 18:00 (non-responders)
    optin_closes_at: at(-1, 18), // Sunday 18:00
    match_at: at(-1, 18, 15), // Sunday 18:15
    nudge_at: at(2, 18), // Wednesday 18:00 (unscheduled sessions)
    reports_due_at: at(6, 23, 59), // week's Sunday 23:59
    digest_at: at(7, 9), // Monday 09:00 after the week
    grace_until: at(10, 23, 59), // Thursday after (used for the final week)
  };
}

export function cohortStartTuple(cohort: Cohort): [number, number, number] {
  const [y, m, d] = cohort.start_date.split('-').map(Number);
  return [y!, m!, d!];
}

export async function createCohort(
  env: Env,
  name: string,
  week1Monday: [number, number, number],
  weeksCount = 3,
): Promise<{ cohortId: number; weeks: Week[] }> {
  await env.DB.prepare("UPDATE cohorts SET status = 'done' WHERE status = 'active'").run();
  const [y, m, d] = week1Monday;
  const res = await env.DB.prepare(
    "INSERT INTO cohorts (name, start_date, weeks_count, status) VALUES (?1, ?2, ?3, 'active')",
  )
    .bind(name, `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, weeksCount)
    .run();
  const cohortId = Number(res.meta.last_row_id);

  for (let idx = 1; idx <= weeksCount; idx++) {
    const a = weekAnchors(week1Monday, idx);
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
