import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { repairScan } from '../src/engine/repair';

describe('standby repair assignments', () => {
  it('respects the volunteer capacity for the needed role', async () => {
    await env.DB.prepare(
      `INSERT INTO cohorts (id, name, status) VALUES (8101, 'Standby cap', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO weeks (id, cohort_id, idx, reports_due_at)
       VALUES (8101, 8101, 1, '2026-10-01T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, status)
       VALUES
         (8101, 'standby-volunteer', 'Standby Volunteer', 'active'),
         (8102, 'standby-victim-a', 'Victim A', 'active'),
         (8103, 'standby-victim-b', 'Victim B', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO optins
         (week_id, participant_id, standby, standby_interviewer_limit, standby_interviewee_limit)
       VALUES (8101, 8101, 1, 1, 3)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO repair_queue (week_id, participant_id, need, state)
       VALUES
         (8101, 8102, 'interviewer', 'open'),
         (8101, 8103, 'interviewer', 'open')`,
    ).run();

    expect(await repairScan(env, new Date('2026-09-01T00:00:00.000Z'))).toBe(1);
    expect(await repairScan(env, new Date('2026-09-01T00:15:00.000Z'))).toBe(0);

    expect(await env.DB.prepare(
      `SELECT count(*) AS n FROM standby_assignments
       WHERE week_id = 8101 AND participant_id = 8101 AND role = 'interviewer'`,
    ).first()).toEqual({ n: 1 });
    expect(await env.DB.prepare(
      `SELECT count(*) AS n FROM sessions
       WHERE week_id = 8101 AND interviewer_id = 8101`,
    ).first()).toEqual({ n: 1 });
    expect(await env.DB.prepare(
      `SELECT state, count(*) AS n FROM repair_queue
       WHERE week_id = 8101 GROUP BY state ORDER BY state`,
    ).all()).toMatchObject({
      results: [
        { state: 'matched', n: 1 },
        { state: 'open', n: 1 },
      ],
    });
  });

  it('spreads standby work across volunteers before reusing capacity', async () => {
    await env.DB.prepare(
      `INSERT INTO cohorts (id, name, status) VALUES (8201, 'Balanced standby', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO weeks (id, cohort_id, idx, reports_due_at)
       VALUES (8201, 8201, 1, '2026-10-01T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, status)
       VALUES
         (8201, 'standby-a', 'Standby A', 'active'),
         (8202, 'standby-b', 'Standby B', 'active'),
         (8203, 'standby-c', 'Standby C', 'active'),
         (8211, 'victim-a', 'Victim A', 'active'),
         (8212, 'victim-b', 'Victim B', 'active'),
         (8213, 'victim-c', 'Victim C', 'active'),
         (8214, 'victim-d', 'Victim D', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO optins
         (week_id, participant_id, standby, standby_interviewer_limit, standby_interviewee_limit)
       VALUES
         (8201, 8201, 1, 3, 3),
         (8201, 8202, 1, 3, 3),
         (8201, 8203, 1, 3, 3)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO repair_queue (week_id, participant_id, need, state)
       VALUES
         (8201, 8211, 'interviewer', 'open'),
         (8201, 8212, 'interviewer', 'open'),
         (8201, 8213, 'interviewer', 'open'),
         (8201, 8214, 'interviewer', 'open')`,
    ).run();

    expect(await repairScan(env, new Date('2026-09-01T00:00:00.000Z'))).toBe(4);
    const { results } = await env.DB.prepare(
      `SELECT participant_id, count(*) AS assignments
       FROM standby_assignments
       WHERE week_id = 8201 AND role = 'interviewer'
       GROUP BY participant_id
       ORDER BY assignments, participant_id`,
    ).all<{ participant_id: number; assignments: number }>();
    expect(results.map((row) => Number(row.assignments))).toEqual([1, 1, 2]);
  });

  it('allows an explicitly opted-in organizer to cover standby sessions', async () => {
    await env.DB.prepare(
      `INSERT INTO cohorts (id, name, status) VALUES (8301, 'Organizer standby', 'active')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO weeks (id, cohort_id, idx, reports_due_at)
       VALUES (8301, 8301, 1, '2026-10-01T00:00:00.000Z')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO participants (id, discord_id, name, status, pairing_excluded)
       VALUES
         (8301, 'organizer-volunteer', 'Organizer Volunteer', 'active', 1),
         (8302, 'organizer-victim', 'Victim', 'active', 0)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO optins
         (week_id, participant_id, regular_opt_in, standby,
          standby_interviewer_limit, standby_interviewee_limit, standby_override_exclusion)
       VALUES (8301, 8301, 0, 1, 1, 0, 1)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO repair_queue (week_id, participant_id, need, state)
       VALUES (8301, 8302, 'interviewer', 'open')`,
    ).run();

    expect(await repairScan(env, new Date('2026-09-01T00:00:00.000Z'))).toBe(1);
    expect(await env.DB.prepare(
      `SELECT interviewer_id, interviewee_id FROM sessions WHERE week_id = 8301`,
    ).first()).toEqual({ interviewer_id: 8301, interviewee_id: 8302 });
  });
});
