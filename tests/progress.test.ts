import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { queueLateOptinDemand } from '../src/engine/repair';
import { creditsOf, matchingCreditsOf } from '../src/engine/progress';

describe('round baseline progress', () => {
  let weekId: number;
  let volunteerId: number;

  beforeAll(async () => {
    const cohort = await env.DB.prepare(
      "INSERT INTO cohorts (name, weeks_count, status) VALUES ('Progress test', 3, 'active')",
    ).run();
    const week = await env.DB.prepare(
      `INSERT INTO weeks (cohort_id, idx, reports_due_at)
       VALUES (?1, 2, '2099-01-14T23:59:00.000Z')`,
    ).bind(Number(cohort.meta.last_row_id)).run();
    weekId = Number(week.meta.last_row_id);

    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, status) VALUES
       (9101, 'progress-volunteer', 'Volunteer', 'active'),
       (9102, 'progress-normal-partner', 'Normal partner', 'active'),
       (9103, 'progress-standby-partner', 'Standby partner', 'active'),
       (9104, 'progress-late-volunteer', 'Late volunteer', 'active')`,
    ).run();
    volunteerId = 9101;

    const normal = await env.DB.prepare(
      `INSERT INTO sessions
         (week_id, interviewer_id, interviewee_id, state, origin, interviewer_credited, interviewee_credited)
       VALUES (?1, 9102, 9101, 'completed', 'match', 1, 1)`,
    ).bind(weekId).run();
    expect(Number(normal.meta.last_row_id)).toBeGreaterThan(0);

    const standby = await env.DB.prepare(
      `INSERT INTO sessions
         (week_id, interviewer_id, interviewee_id, state, origin, interviewer_credited, interviewee_credited)
       VALUES (?1, 9103, 9101, 'completed', 'repair', 1, 1)`,
    ).bind(weekId).run();
    await env.DB.prepare(
      `INSERT INTO standby_assignments (week_id, participant_id, role, slot, session_id)
       VALUES (?1, 9101, 'interviewee', 1, ?2)`,
    ).bind(weekId, Number(standby.meta.last_row_id)).run();

    const lateStandby = await env.DB.prepare(
      `INSERT INTO sessions
         (week_id, interviewer_id, interviewee_id, state, origin)
       VALUES (?1, 9103, 9104, 'pending_schedule', 'repair')`,
    ).bind(weekId).run();
    await env.DB.prepare(
      `INSERT INTO standby_assignments (week_id, participant_id, role, slot, session_id)
       VALUES (?1, 9104, 'interviewee', 1, ?2)`,
    ).bind(weekId, Number(lateStandby.meta.last_row_id)).run();
  });

  it('keeps standby work in totals but excludes it from matching pace', async () => {
    await expect(creditsOf(env, volunteerId)).resolves.toEqual({ interviewer: 0, interviewee: 2 });
    await expect(matchingCreditsOf(env, volunteerId)).resolves.toEqual({ interviewer: 0, interviewee: 1 });
  });

  it('does not let an existing standby extra consume a late normal opt-in', async () => {
    const result = await queueLateOptinDemand(env, weekId, 9104, false);
    expect(result).toEqual({ created: 2, pending: 2 });
    const rows = await env.DB.prepare(
      `SELECT need, count(*) AS n FROM repair_queue
       WHERE week_id = ?1 AND participant_id = 9104 AND state = 'open'
       GROUP BY need ORDER BY need`,
    ).bind(weekId).all<{ need: string; n: number }>();
    expect(rows.results).toEqual([
      { need: 'interviewee', n: 1 },
      { need: 'interviewer', n: 1 },
    ]);
  });
});
